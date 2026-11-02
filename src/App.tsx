Warning: truncated output (original token count: 24754)
Total output lines: 718

import { useCallback, useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { supabase } from './supabase'
import {
  Activity, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Copy,
  ClipboardList, Coins, Compass, Dices, DoorOpen, Eye, EyeOff, Feather, Gamepad2, Globe2, Heart, Image as ImageIcon, KeyRound, LogOut,
  MessageCircle, MonitorPlay, Plus, RefreshCw, ScrollText, Send, Settings, Shield, Sparkles, Swords, Trash2, TreePine, Upload, Users, X,
} from 'lucide-react'

type User = { id: number; email: string; username: string; displayName: string; role: 'gm' | 'player'; mustChangePassword: boolean; authLinked: boolean }
type Campaign = { id: number; gameId: string; name: string; inviteCode: string | null; legacyJoinPassword?: string | null; joinPasswordSet: boolean; isOpen: boolean; status: 'active' | 'paused' | 'stopped'; isOwner: boolean }
type SessionData = { user: User; campaign: Campaign | null }
type Lobby = { id: number; gameId: string; name: string; isOpen: boolean; hostName: string; playerCount: number; createdAt: string }
type TunnelStatus = { status: 'stopped' | 'starting' | 'online' | 'stopping' | 'error'; publicUrl: string | null; error: string | null }
type Character = {
  id: number; campaign_id: number; owner_id: number; name: string; age: string; species: string; origin: string;
  portrait: string; description: string; stats: Record<string, number>; hp_current: number; hp_max: number;
  wounds: string; states: string; talents: { name: string; description: string; effect: string; notes: string }[];
  equipment: string[]; gold: number; kind: 'player' | 'companion' | 'npc' | 'monster' | 'other'; magic: string; goals: string; relationships: string; experience: number; updated_at: string;
}
type Member = { id: number; displayName: string; role: 'gm' | 'player'; online: boolean; characterId: number | null; characterName: string | null }
type Roll = {
  id: number; display_name: string; character_name: string | null; notation: string; dice: number[]; modifier: number;
  total: number; kind: string; detail: null | { natural: number; stat: string; statBonus: number; circumstance: number; difficulty: number; verdict: string; action: string };
  created_at: string;
}
type GameImage = { id: number; name: string; contentType: string; byteSize: number; isShown: boolean; createdAt: string; url: string }
type RollRequest = {
  id: string; target_user_id: number | null; target_group: boolean; target_name: string | null; character_id: number | null;
  character_name: string | null; action: string; stat: string; difficulty: number; stat_bonus: number;
  circumstance: number; context: string; expires_at: string | null; status: string; created_at: string;
  result: { detail: Roll['detail']; total: number; dice: number[]; player: string } | null;
}
type View = 'game' | 'table' | 'character' | 'requests' | 'players' | 'settings' | 'selectCharacter'

const STAT_LIST = ['Force', 'Constitution', 'Agilité', 'Magie', 'Perception', 'Intelligence', 'Charisme']
const BONUS_POOL = [3, 2, 1, 1, 0, 0, 0]
const CHARACTER_KIND_LABEL: Record<Character['kind'], string> = { player: 'Héros', companion: 'Compagnon', npc: 'PNJ', monster: 'Monstre', other: 'Autre fiche MJ' }
const hasOfficialStats = (stats: Record<string, number>) => JSON.stringify(Object.values(stats).sort((a, b) => b-a)) === JSON.stringify([...BONUS_POOL].sort((a,b)=>b-a))
const STAT_HELP: Record<string, string> = {
  Force: 'Puissance physique, corps à corps et obstacles', Constitution: 'Endurance, résistance et poisons', Agilité: 'Réflexes, équilibre, discrétion et esquive',
  Magie: 'Phénomènes magiques et forces surnaturelles', Perception: 'Observation, dangers et traces', Intelligence: 'Connaissances, raisonnement et analyse', Charisme: 'Persuasion, négociation et tromperie',
}
const api = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue.')
  return data as T
}
const dateLabel = (raw: string) => new Date(`${raw.replace(' ', 'T')}${raw.includes('Z') ? '' : 'Z'}`).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const verdictLabel: Record<string, string> = { success: 'Réussite', failure: 'Échec', critical_success: 'Réussite critique', critical_failure: 'Échec critique' }
const verdictClass: Record<string, string> = { success: 'success', failure: 'failure', critical_success: 'critical-success', critical_failure: 'critical-failure' }

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [view, setView] = useState<View>('table')
  const [viewHistory, setViewHistory] = useState<View[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
  const [rolls, setRolls] = useState<Roll[]>([])
  const [gameImages, setGameImages] = useState<GameImage[]>([])
  const [requests, setRequests] = useState<RollRequest[]>([])
  const [toast, setToast] = useState('')
  const [socket, setSocket] = useState<Socket | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [creatingCharacter, setCreatingCharacter] = useState(false)
  const [lastJoinPassword, setLastJoinPassword] = useState('')
  const [campaignHome, setCampaignHome] = useState(false)

  const refresh = useCallback(async () => {
    if (!session?.campaign || session.user.mustChangePassword) return
    const [nextMembers, nextCharacters, nextRolls, nextRequests, selectedCharacter, nextImages] = await Promise.all([
      api<Member[]>('/api/members'), api<Character[]>('/api/characters'), api<Roll[]>('/api/rolls'), api<RollRequest[]>('/api/requests'), api<Character | null>('/api/active-character'), api<GameImage[]>('/api/game-images'),
    ])
    setMembers(nextMembers); setCharacters(nextCharacters); setRolls(nextRolls); setRequests(nextRequests)
    setGameImages(nextImages)
    setActiveCharacter(selectedCharacter); setLoadingData(false)
  }, [session])

  useEffect(() => {
    api<SessionData>('/api/me').then((data) => {
      setSession(data)
      setCampaignHome(data.user.role === 'gm' && (!data.campaign || data.campaign.status !== 'active'))
      setView(data.user.mustChangePassword ? 'settings' : data.user.role === 'player' ? 'selectCharacter' : 'game')
    }).catch(() => undefined).finally(() => setInitializing(false))
  }, [])
  useEffect(() => { if (session) refresh().catch((error) => setToast(error.message)) }, [session, refresh])
  useEffect(() => {
    if (!session?.campaign || session.user.mustChangePassword) return
    const next = io()
    const sync = () => refresh().catch(() => undefined)
    next.on('connect', sync)
    next.on('roll:new', (roll: Roll) => setRolls((current) => [roll, ...current.filter((v) => v.id !== roll.id)].slice(0, 100)))
    next.on('request:new', (request: RollRequest) => setRequests((current) => [request, ...current.filter((v) => v.id !== request.id)]))
    next.on('request:updated', (request: RollRequest) => setRequests((current) => [request, ...current.filter((v) => v.id !== request.id)]))
    next.on('character:updated', () => refresh().catch(() => undefined))
    next.on('game:images:updated', () => refresh().catch(() => undefined))
    next.on('character:active', ({ userId, characterId }: { userId: number; characterId: number }) => {
      setMembers((current) => current.map((member) => member.id === userId ? { ...member, characterId } : member))
    })
    next.on('campaign:updated', (campaign: Campaign) => setSession((current) => current ? { ...current, campaign } : current))
    next.on('campaign:deleted', () => window.location.reload())
    next.on('presence:update', ({ userId, online }: { userId: number; online: boolean }) => setMembers((current) => current.map((v) => v.id === userId ? { ...v, online } : v)))
    setSocket(next)
    return () => { next.disconnect(); setSocket(null) }
  }, [session?.campaign?.id, session?.user.id, session?.user.mustChangePassword, refresh])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4000); return () => clearTimeout(timer) }, [toast])

  const signIn = (data: SessionData) => {
    setSession(data); setLoadingData(true); setCreatingCharacter(false)
    setViewHistory([])
    setCampaignHome(data.user.role === 'gm' && (!data.campaign || data.campaign.status !== 'active'))
    setView(data.user.mustChangePassword ? 'settings' : data.user.role === 'player' ? 'selectCharacter' : data.campaign ? 'game' : 'settings')
  }
  const onCampaignSelected = (campaign: Campaign) => {
    setCampaignHome(false)
    setViewHistory([])
    setSession((current) => current ? { ...current, campaign } : current)
    setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setLoadingData(true); setCreatingCharacter(false)
    setView(session?.user.role === 'player' ? 'selectCharacter' : 'game')
  }
  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch { /* Clear the local session even when the server is offline. */ }
    try { await supabase.auth.signOut() } catch { /* The local app session is still cleared below. */ }
    socket?.disconnect(); setSocket(null); setSession(null)
    setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setGameImages([]); setCampaignHome(false); setLoadingData(true); setCreatingCharacter(false); setLastJoinPassword(''); setViewHistory([])
    window.history.replaceState(null, '', window.location.pathname)
  }
  const navigateTo = (next: View) => {
    if (next !== view) setViewHistory((history) => [...history, view].slice(-20))
    setView(next)
  }
  const goBack = () => {
    const previous = viewHistory.at(-1)
    if (!previous) { void signOut(); return }
    setViewHistory((history) => history.slice(0, -1))
    setView(previous)
  }

  if (initializing) return <div className="loading-screen"><div className="sigil"><Sparkles /></div><p>La table s’éveille…</p></div>
  if (!session) return <WelcomeFlow onAuthenticated={signIn} />
  if (session.user.mustChangePassword) return <><MainMenuActions onMenu={signOut} onSignOut={signOut}/><SettingsView user={session.user} campaign={session.campaign} forced onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setCampaignHome(user.role === 'gm' && (!campaign || campaign.status !== 'active')); setViewHistory([]); setView(user.role === 'gm' && !campaign ? 'settings' : user.role === 'player' ? 'selectCharacter' : 'game') }} onCampaignSelected={onCampaignSelected} onCampaignDeleted={() => undefined} onToast={setToast} /></>
  if (!session.campaign || campaignHome) return session.user.role === 'gm'
    ? <><MainMenuActions onMenu={signOut} onSignOut={signOut}/><CampaignCreateScreen user={session.user} onSelected={onCampaignSelected} onCreated={(campaign, joinPassword) => { setCampaignHome(false); setSession((current) => current ? { ...current, campaign } : current); setLastJoinPassword(joinPassword); setViewHistory([]); setView('game') }} /></>
    : <WelcomeFlow onAuthenticated={signIn} initialRole="player" />

  const isGM = session.user.role === 'gm'
  const ownCharacter = activeCharacter
  const pending = requests.filter((request) => request.status === 'pending' && (isGM || request.target_user_id === session.user.id || request.target_group)).length
  const nav: { id: View; label: string; icon: typeof Dices; badge?: number }[] = [
    { id: 'game', label: 'Game', icon: MonitorPlay },
    { id: 'table', label: 'La table', icon: Dices },
    { id: 'character', label: 'Personnage', icon: BookOpen },
    ...(isGM ? [{ id: 'requests' as View, label: 'Requêtes de test', icon: ClipboardList, badge: pending }] : [{ id: 'requests' as View, label: 'Tests demandés', icon: ClipboardList, badge: pending }]),
    { id: 'players', label: 'Participants', icon: Users },
    { id: 'settings', label: 'Réglages', icon: Settings },
  ]

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={19} /></div><div><strong>Yuta et les 11</strong><span>LA TABLE DE JEU</span></div></div>
      <div className="campaign-chip"><span className="status-dot" /> CAMPAGNE EN COURS <ChevronDown size={14} /></div>
      <div className="side-label">ESPACE DE JEU</div>
      <nav className="side-nav">{nav.map(({ id, label, icon: Icon, badge }) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => navigateTo(id)}><Icon size={17} /><span>{label}</span>{badge ? <b className="nav-badge">{badge}</b> : null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><span className={socket?.connected ? 'status-dot' : 'status-dot offline'} />{socket?.connected ? 'Synchronisé en direct' : 'Reconnexion…'}</div><div className="profile-row"><div className="avatar">{session.user.displayName.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{session.user.displayName}</strong><span>{isGM ? 'Maître du Jeu' : ownCharacter?.name || 'Joueur'}</span></div><button className="icon-button" aria-label="Réglages du compte" title="Réglages du compte" onClick={() => navigateTo('settings')}><Settings size={15} /></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">CAMPAGNE <span>/</span> <strong>{session.campaign.name}</strong></div><div className="top-actions"><span className="online-count"><i /> {members.filter((m) => m.online).length} en ligne</span><button className="topbar-nav-button" onClick={goBack} aria-label={viewHistory.length ? 'Retour à l’écran précédent' : 'Retour au menu principal'} title={viewHistory.length ? 'Retour' : 'Menu principal'}><ArrowLeft size={14}/><span>{viewHistory.length ? 'Retour' : 'Menu principal'}</span></button><button className="topbar-nav-button logout" onClick={() => void signOut()} aria-label="Se déconnecter" title="Se déconnecter"><LogOut size={14}/><span>Déconnexion</span></button><button className="small-avatar" title="Réglages du compte" onClick={() => navigateTo('settings')}>{session.user.displayName.slice(0, 1).toUpperCase()}</button></div></header>
      {session.campaign.status !== 'active' && <div className={`campaign-state-banner ${session.campaign.status}`}>{session.campaign.status === 'paused' ? 'Campagne en pause : les lancers et les tests sont suspendus. Le MJ peut la reprendre dans Réglages.' : 'Campagne arrêtée : les lancers et les inscriptions sont suspendus. Le MJ peut la réactiver dans Réglages.'}</div>}
      <div className="page-content">
        {loadingData && <div className="loading-card"><div className="sigil"><Sparkles size={17}/></div><span>La partie se prépare…</span></div>}
        {!loadingData && view === 'selectCharacter' && characters.length === 0 && <CharacterView user={session.user} characters={characters} members={members} forceNew onSaved={(character) => { setCharacters([character]); setActiveCharacter(character); setCreatingCharacter(false); navigateTo('game') }} onToast={setToast} />}
        {!loadingData && view === 'selectCharacter' && characters.length > 0 && <CharacterPickerView characters={characters} activeCharacter={activeCharacter} onSelect={async (character) => { try { const chosen = await api<Character>('/api/active-character', { method: 'POST', body: JSON.stringify({ characterId: character.id }) }); setActiveCharacter(chosen); navigateTo('game') } catch (error) { setToast(error instanceof Error ? error.message : 'Choix impossible.') } }} onCreate={() => { setCreatingCharacter(true); navigateTo('character') }} />}
        {!loadingData && view === 'game' && <GameView isGM={isGM} campaignStatus={session.campaign.status} character={ownCharacter} images={gameImages} rolls={rolls.slice(0, 6)} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal de jeu.')).catch((e) => setToast(e.message))} onUpload={async (payload) => { const image = await api<GameImage>('/api/game-images', { method: 'POST', body: JSON.stringify(payload) }); setGameImages((current) => [image, ...current]); setToast('Image ajoutée à la galerie de campagne.') }} onShow={async (image, isShown) => { const updated = await api<GameImage>(`/api/game-images/${image.id}`, { method: 'PATCH', body: JSON.stringify({ isShown }) }); setGameImages((current) => current.map((item) => item.id === updated.id ? updated : { ...item, isShown: isShown ? false : item.isShown })); setToast(isShown ? 'Image affichée aux joueurs.' : 'Image retirée de l’écran des joueurs.') }} onDelete={async (image) => { await api(`/api/game-images/${image.id}`, { method: 'DELETE' }); setGameImages((current) => current.filter((item) => item.id !== image.id)); setToast('Image supprimée de la galerie.') }} />}
        {!loadingData && view === 'table' && <TableView session={{ ...session, campaign: session.campaign! }} isGM={isGM} ownCharacter={ownCharacter} members={members} rolls={rolls} requests={requests} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal partagé.')).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onGo={navigateTo} />}
        {!loadingData && view === 'character' && <CharacterView user={session.user} characters={characters} members={members} activeCharacter={activeCharacter} forceNew={creatingCharacter} onCreateNew={() => setCreatingCharacter(true)} onCancelCreate={() => setCreatingCharacter(false)} onActiveCharacter={setActiveCharacter} onSaved={(character) => { setCharacters((current) => [character, ...current.filter((v) => v.id !== character.id)]); if (session.user.role === 'player') { setActiveCharacter(character); setCreatingCharacter(false); navigateTo('game') } else setCreatingCharacter(false) }} onToast={setToast} />}
        {view === 'requests' && <RequestsView isGM={isGM} campaignStatus={session.campaign.status} userId={session.user.id} members={members} characters={characters} requests={requests} onCreate={(payload) => api<RollRequest>('/api/requests', { method: 'POST', body: JSON.stringify(payload) }).then((request) => { setRequests((current) => [request, ...current.filter((v) => v.id !== request.id)]); setToast('La demande de test a été envoyée.') }).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onCancel={(id) => api<RollRequest>(`/api/requests/${id}/cancel`, { method: 'POST' }).then((request) => setRequests((current) => current.map((v) => v.id === id ? request : v))).catch((e) => setToast(e.message))} />}
        {!loadingData && view === 'players' && <PlayersView members={members} campaign={session.campaign} />}
        {!loadingData && view === 'settings' && <SettingsView user={session.user} campaign={session.campaign} lastJoinPassword={lastJoinPassword} onJoinPasswordChanged={setLastJoinPassword} onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setToast('Profil enregistré.'); if (!campaign && user.role === 'gm') navigateTo('table') }} onCampaignSelected={onCampaignSelected} onCa…14754 tokens truncated…onCancelCreate}>Annuler</button>}{isGM && !forceNew && <button type="button" className="button-primary" onClick={onCreateNew}><Plus size={15}/> Nouvelle fiche</button>}{!isGM && !forceNew && <button type="button" className="button-primary" onClick={onCreateNew}><Plus size={15}/> Nouveau personnage</button>}</div></div>
    {!isGM && (!own || forceNew) && <div className="character-create-note"><Sparkles size={19}/><span>{own ? 'Ajoutez un nouveau héros à votre collection.' : 'Votre aventure commence par votre personnage. Répartissez les sept bonus officiels pour créer sa fiche.'}</span></div>}
    {isGM && !selected && !forceNew && <div className="empty-panel"><BookOpen size={27}/><strong>Aucune fiche pour le moment</strong><span>Crée un héros, un compagnon, un PNJ ou un monstre pour cette campagne.</span><button className="button-primary" onClick={onCreateNew}><Plus size={15}/> Créer une fiche</button></div>}
    {(selected || !isGM || (isGM && forceNew)) && <form className="character-layout" onSubmit={submit}><div className="panel character-main"><div className="panel-heading"><div><div className="eyebrow">{selected ? CHARACTER_KIND_LABEL[selected.kind || 'player'].toUpperCase() : isGM ? 'NOUVELLE FICHE' : 'IDENTITÉ'}</div><h2>{selected ? selected.name : 'Nouveau personnage'}</h2></div><span className="subtle-icon"><Feather size={17}/></span></div><div className="portrait-editor"><div className="portrait-preview">{pendingPortrait?.preview || selected?.portrait ? <img src={pendingPortrait?.preview || selected?.portrait} alt={`Portrait de ${selected?.name || form.name || 'ce personnage'}`}/> : <span><ImageIcon size={24}/><small>VISUEL DU PERSONNAGE</small></span>}</div><div className="portrait-controls"><strong>Portrait / illustration</strong><small>JPG, PNG, GIF ou WebP · 10 Mo maximum</small><div><label className="button-outline portrait-upload-button"><Upload size={14}/>{pendingPortrait ? 'Changer l’image' : selected?.portrait ? 'Remplacer l’image' : 'Ajouter une image'}<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => void choosePortrait(event)}/></label>{(pendingPortrait || selected?.portrait) && <button type="button" className="button-quiet danger-text" onClick={() => void removePortrait()}>{pendingPortrait ? 'Annuler' : 'Supprimer'}</button>}</div>{pendingPortrait && <small className="portrait-pending-note">L’image sera enregistrée avec la fiche.</small>}</div></div>{isGM && !selected && <div className="character-kind-form"><label>Type de fiche<select value={characterKind} onChange={(event) => setCharacterKind(event.target.value as Character['kind'])}><option value="companion">Compagnon jouable</option><option value="npc">PNJ sous le contrôle du MJ</option><option value="monster">Monstre</option><option value="other">Autre fiche MJ</option></select></label>{characterKind === 'companion' && <label>Attribuer à<select value={assignedPlayerId || ''} onChange={(event) => setAssignedPlayerId(Number(event.target.value))} required><option value="">Choisir un joueur</option>{members.filter((member) => member.role === 'player').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}<small>Les compagnons attribués apparaîtront dans la liste des personnages jouables du joueur.</small></div>}<div className="identity-grid"><label>Nom du personnage<input value={form.name} onChange={(e) => edit('name', e.target.value)} required minLength={2}/></label><label>Âge<input value={form.age} onChange={(e) => edit('age', e.target.value)} placeholder="Âge ou époque"/></label><label>Espèce<input value={form.species} onChange={(e) => edit('species', e.target.value)} placeholder="Humaine, elfe…"/></label><label>Origine<input value={form.origin} onChange={(e) => edit('origin', e.target.value)} placeholder="Région, peuple…"/></label></div><label className="wide-label">Description<textarea rows={5} value={form.description} onChange={(e) => edit('description', e.target.value)} placeholder="Apparence, tempérament, histoire…"/></label><div className="character-owner"><span className="avatar">{(selected?.name || form.name || user.displayName).slice(0,1).toUpperCase()}</span><span>{selected ? selected.kind === 'npc' || selected.kind === 'monster' || selected.kind === 'other' ? 'Sous le contrôle du' : 'Joué par' : characterKind === 'npc' || characterKind === 'monster' || characterKind === 'other' ? 'Sous le contrôle du' : 'Attribué à'} <strong>{selected ? members.find((member) => member.id === selected.owner_id)?.displayName || user.displayName : characterKind === 'companion' ? members.find((member) => member.id === assignedPlayerId)?.displayName || 'Choisir un joueur' : user.displayName}</strong></span></div></div>
      <div className="panel stats-panel"><div className="panel-heading"><div><div className="eyebrow">LES SEPT CARACTÉRISTIQUES</div><h2>Répartition des bonus</h2></div><span className={validPool ? 'pool-sum good' : 'pool-sum'}>{Object.values(stats).reduce((a,b)=>a+b,0)} <small>/ 7</small></span></div><p className="muted stats-intro">{selected && !isGM ? 'Les bonus sont définis avec le MJ.' : isGM ? 'Utilise les bonus officiels ou active une dérogation pour cette fiche.' : 'Chaque bonus officiel est attribué une seule fois.'}</p><div className="stat-list">{STAT_LIST.map((stat) => <div className="stat-row" key={stat}><span><strong>{stat}</strong><small>{STAT_HELP[stat]}</small></span>{isGM && allowCustom ? <input className="custom-stat-input" type="number" min={-99} max={99} value={stats[stat] ?? 0} onChange={(e) => setStats((current) => ({ ...current, [stat]: Number(e.target.value) }))}/> : <select disabled={!!selected && !isGM} value={stats[stat] ?? 0} onChange={(e) => setStats((current) => ({ ...current, [stat]: Number(e.target.value) }))}>{BONUS_POOL.map((bonus, idx) => <option key={`${bonus}-${idx}`} value={bonus}>{bonus >= 0 ? '+' : ''}{bonus}</option>)}</select>}</div>)}</div>{isGM && (selected || forceNew) && <><div className="hp-editor"><label>PV actuels<input type="number" min={0} max={9999} value={hpCurrent} onChange={(e) => setHpCurrent(Number(e.target.value))}/></label><label>PV maximum<input type="number" min={1} max={9999} value={hpMax} onChange={(e) => setHpMax(Number(e.target.value))}/></label></div><label className="check-row"><input type="checkbox" checked={allowCustom} onChange={(e) => setAllowCustom(e.target.checked)}/> Autoriser une dérogation aux bonus officiels</label></>}{!isGM && !selected && <div className="pool-note"><CircleHelp size={15}/> La distribution doit être exactement : +3, +2, +1, +1, +0, +0, +0.</div>}{!isGM && selected && <div className="health-bar"><span><Heart size={15}/> Santé</span><strong>{selected.hp_current} / {selected.hp_max} PV</strong></div>}
      <button className="button-primary save-character" disabled={busy || (!selected && !validPool && !allowCustom)}><Check size={16}/>{busy ? 'Enregistrement…' : selected ? 'Enregistrer la fiche' : isGM ? 'Créer cette fiche' : 'Créer mon personnage'}</button></div></form>}
    {selected && <div className="character-extras"><section className="panel extra-panel inventory-panel"><div className="panel-heading"><div><div className="eyebrow">BOURSE & ÉQUIPEMENT</div><h2>Inventaire</h2></div><span className="subtle-icon"><Coins size={17}/></span></div>{isGM ? <form className="inventory-form" onSubmit={saveInventory}><label>Golds détenus<input type="number" min={0} max={999999999} step={1} value={gold} onChange={(event) => setGold(Number(event.target.value))} required/></label><label>Objets possédés<textarea rows={6} maxLength={12000} value={inventoryText} onChange={(event) => setInventoryText(event.target.value)} placeholder={'Épée de voyage\nPotion × 2\nUne ligne par objet'} /></label><small>Une ligne par objet. Indique la quantité dans la ligne, par exemple « Potion × 2 ».</small><button className="button-primary" disabled={inventoryBusy}><Check size={15}/>{inventoryBusy ? 'Enregistrement…' : 'Enregistrer les ressources'}</button></form> : <><div className="inventory-wallet"><span>PORTE-MONNAIE</span><strong>{(selected.gold ?? 0).toLocaleString('fr-FR')} golds</strong></div><div className="inventory-list"><span>OBJETS POSSÉDÉS</span>{selected.equipment.length ? <ul>{selected.equipment.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>Aucun objet enregistré pour le moment.</p>}</div><p className="inventory-note">Le MJ met à jour votre inventaire et votre bourse.</p></>}</section><section className="panel extra-panel"><div className="eyebrow">MAGIE & PROGRESSION</div><h3>Une histoire en devenir</h3><p className="muted">La campagne ne présume d’aucune règle de magie, de soins ou d’évolution.</p></section></div>}
  </>
}

function RequestsView({ isGM, campaignStatus, userId, members, characters, requests, onCreate, onResolve, onCancel }: {
  isGM: boolean; campaignStatus: Campaign['status']; userId: number; members: Member[]; characters: Character[]; requests: RollRequest[];
  onCreate: (payload: object) => void; onResolve: (id: string) => void; onCancel: (id: string) => void;
}) {
  const [targetUserId, setTargetUserId] = useState<number>(members.find((m) => m.role === 'player')?.id || 0)
  const [targetGroup, setTargetGroup] = useState(false)
  const [action, setAction] = useState('')
  const [stat, setStat] = useState(STAT_LIST[0])
  const [difficulty, setDifficulty] = useState(15)
  const [bonusChoice, setBonusChoice] = useState('actual')
  const [circumstance, setCircumstance] = useState(0)
  const [context, setContext] = useState('')
  const [expiresMinutes, setExpiresMinutes] = useState('')
  const [characterId, setCharacterId] = useState('')
  const targetCharacter = characters.find((c) => c.owner_id === targetUserId)
  useEffect(() => { setCharacterId(targetCharacter ? String(targetCharacter.id) : '') }, [targetUserId, targetCharacter?.id])
  const myRequests = isGM ? requests : requests.filter((r) => r.target_user_id === userId || r.target_group)
  const visible = myRequests
  const proposedBonus = bonusChoice === 'actual' && targetCharacter ? targetCharacter.stats[stat] ?? 0 : bonusChoice === 'actual' ? 0 : Number(bonusChoice)
  return <><div className="welcome-row"><div><div className="eyebrow">{isGM ? 'LES DÉFIS DE LA CAMPAGNE' : 'VOTRE PROCHAIN TEST'}</div><h1>{isGM ? <>Demander un <em>lancer</em></> : <>Vos requêtes de <em>lancer</em></>}</h1><p className="muted">{isGM ? 'Choisissez le joueur, le seuil et le bonus. Le serveur conservera les valeurs envoyées.' : 'Le MJ fixe les paramètres ; le résultat est calculé et partagé automatiquement.'}</p></div><div className="session-tag"><ScrollText size={15}/> D20 · SYSTÈME YUTA</div></div>
    {isGM && campaignStatus === 'active' && <div className="request-layout"><section className="panel request-form-panel"><div className="panel-heading"><div><div className="eyebrow">NOUVELLE DEMANDE</div><h2>Préparer le test</h2></div><span className="subtle-icon"><ClipboardList size={18}/></span></div><form className="request-form" onSubmit={(event) => { event.preventDefault(); onCreate({ targetUserId, targetGroup, characterId: targetGroup ? null : characterId || null, action, stat, difficulty, statBonus: proposedBonus, circumstance, context, expiresMinutes: expiresMinutes || null }); setAction(''); setContext('') }}>
      <label>Joueur concerné<select value={targetGroup ? 'group' : targetUserId} onChange={(e) => { if (e.target.value === 'group') setTargetGroup(true); else { setTargetGroup(false); setTargetUserId(Number(e.target.value)) } }}><option value="group">Tout le groupe — premier joueur à répondre</option>{members.filter((m) => m.role === 'player').map((m) => <option value={m.id} key={m.id}>{m.displayName}</option>)}</select></label>
      {!targetGroup && targetCharacter && <label>Personnage<select value={characterId} onChange={(e) => setCharacterId(e.target.value)}><option value="">Aucun personnage associé</option><option value={targetCharacter.id}>{targetCharacter.name}</option></select></label>}
      <label>Action demandée<input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Ex. Franchir le gouffre" required maxLength={120}/></label>
      <div className="request-pair"><label>Caractéristique<select value={stat} onChange={(e) => { setStat(e.target.value); setBonusChoice('actual') }}>{STAT_LIST.map((v) => <option key={v}>{v}</option>)}</select></label><label>Difficulté<input type="number" min={-1000} max={1000} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}/></label></div>
      <div className="request-pair"><label>Bonus de caractéristique<select value={bonusChoice} onChange={(e) => setBonusChoice(e.target.value)}><option value="actual">Bonus réel du personnage ({targetCharacter ? `+${targetCharacter.stats[stat]}` : '+0'})</option>{[3,2,1,0].map((v) => <option key={v} value={v}>+{v} — choix manuel</option>)}</select></label><label>Modificateur circonstanciel<input type="number" min={-1000} max={1000} value={circumstance} onChange={(e) => setCircumstance(Number(e.target.value))}/></label></div>
      <label>Contexte pour le joueur<textarea rows={2} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Un détail utile sur le test…" maxLength={600}/></label>
      <label>Expiration<select value={expiresMinutes} onChange={(e) => setExpiresMinutes(e.target.value)}><option value="">Aucune</option><option value="5">Dans 5 minutes</option><option value="15">Dans 15 minutes</option><option value="60">Dans 1 heure</option><option value="1440">Dans 24 heures</option></select></label>
      <div className="request-preview"><span className="preview-die"><Dices size={17}/></span><div><span>TEST PROPOSÉ</span><strong>{stat} · Difficulté {difficulty}</strong></div><b>+{proposedBonus}{circumstance ? ` ${circumstance > 0 ? '+' : '−'} ${Math.abs(circumstance)}` : ''}</b></div>
      <button className="button-primary send-request" disabled={!members.some((m) => m.role === 'player')}><Send size={16}/> Envoyer la demande</button>
    </form></section><RequestList requests={visible} isGM={isGM} userId={userId} onResolve={onResolve} onCancel={onCancel}/></div>}
    {isGM && campaignStatus !== 'active' && <><div className="campaign-inactive-note"><Shield size={18}/><span>Les demandes de test sont suspendues pendant une pause ou après l’arrêt de la campagne.</span></div><RequestList requests={visible} isGM userId={userId} onResolve={onResolve} onCancel={onCancel}/></>}
    {!isGM && <div className="player-requests"><RequestList requests={visible} isGM={false} userId={userId} onResolve={onResolve} onCancel={onCancel}/></div>}
  </>
}
function RequestList({ requests, isGM, userId, onResolve, onCancel }: { requests: RollRequest[]; isGM: boolean; userId: number; onResolve: (id: string) => void; onCancel: (id: string) => void }) {
  const sorted = [...requests].sort((a,b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at))
  return <section className="panel requests-panel"><div className="panel-heading"><div><div className="eyebrow">JOURNAL DES TESTS</div><h2>{isGM ? 'Requêtes de la campagne' : 'Vos tests'}</h2></div><span className="request-count">{requests.filter((r) => r.status === 'pending').length} en attente</span></div><div className="request-list">{sorted.length ? sorted.map((request) => {
    const canAnswer = !isGM && request.status === 'pending' && (request.target_user_id === userId || request.target_group)
    const result = request.result?.detail
    return <article className={`request-card ${request.status}`} key={request.id}><div className="request-card-top"><span className={`request-status ${request.status}`}><i/>{({ pending: 'EN ATTENTE', resolved: 'RÉSOLU', cancelled: 'ANNULÉE', expired: 'EXPIRÉE' } as Record<string,string>)[request.status] || request.status}</span><span className="request-target">{request.target_group ? 'Tout le groupe' : request.target_name}</span></div><div className="request-card-main"><div><h3>{request.action}</h3><p>{request.stat} <i>·</i> Difficulté <strong>{request.difficulty}</strong> <i>·</i> Bonus <strong>+{request.stat_bonus}</strong>{request.circumstance ? ` · ${request.circumstance > 0 ? '+' : '−'}${Math.abs(request.circumstance)} circonstance` : ''}</p>{request.context && <div className="request-context">« {request.context} »</div>}</div><span className="request-d20">D20</span></div>
      {request.result && result && <div className={`resolved-result ${verdictClass[result.verdict]}`}><span className="resolved-natural">{request.result.dice?.[0]}</span><div><span>{result.stat} {result.statBonus >= 0 ? '+' : ''}{result.statBonus}{result.circumstance ? ` ${result.circumstance > 0 ? '+' : '−'} ${Math.abs(result.circumstance)}` : ''} = <strong>{request.result.total}</strong> / {result.difficulty}</span><b>{verdictLabel[result.verdict]}</b><small>{request.result.player} a répondu</small></div></div>}
      {request.status === 'pending' && <div className="request-actions">{canAnswer && <button className="button-primary" onClick={() => onResolve(request.id)}><Dices size={16}/> Lancer le D20</button>}{isGM && <button className="button-quiet danger-text" onClick={() => onCancel(request.id)}><X size={15}/> Annuler</button>}</div>}
      <div className="request-time">Demande envoyée à {dateLabel(request.created_at)}{request.expires_at && request.status === 'pending' ? ` · Expire à ${dateLabel(request.expires_at)}` : ''}</div>
    </article>
  }) : <div className="empty-state"><div className="empty-die"><ClipboardList size={21}/></div><strong>Aucun test à afficher</strong><span>{isGM ? 'Créez une demande pour lancer la prochaine scène.' : 'Quand le MJ demandera un test, il apparaîtra ici.'}</span></div>}</div></section>
}

function PlayersView({ members, campaign }: { members: Member[]; campaign: Campaign }) {
  const [copied, setCopied] = useState(false)
  return <><div className="welcome-row"><div><div className="eyebrow">LES VISAGES DU RÉCIT</div><h1>À la <em>table</em></h1><p className="muted">Les personnes réunies dans cette campagne privée.</p></div></div><div className="players-layout"><section className="panel member-panel"><div className="panel-heading"><div><div className="eyebrow">COMPAGNONS DE ROUTE</div><h2>Participants</h2></div><span className="request-count">{members.length} inscrits</span></div><div className="member-list">{members.map((member) => <div className="member-card" key={member.id}><div className="member-avatar-wrap"><div className="avatar large">{member.displayName.slice(0,1).toUpperCase()}</div><i className={member.online ? 'status-dot' : 'status-dot offline'}/></div><div className="member-detail"><strong>{member.displayName}</strong><span>{member.role === 'gm' ? 'Maître du Jeu' : member.characterName || 'Personnage à créer'}</span></div><span className={member.online ? 'member-online' : 'member-offline'}>{member.online ? 'En ligne' : 'Absent'}</span></div>)}</div></section><section className="panel invite-panel"><div className="invite-art"><div className="invite-ring"><Users size={24}/></div></div><div className="eyebrow">UNE PLACE AUTOUR DU FEU</div><h2>Inviter un joueur</h2><p className="muted">Partagez le lien en ligne depuis les réglages, puis transmettez le mot de passe de <strong>{campaign.name}</strong> séparément.</p><div className="invite-code"><span>{campaign.gameId}</span><button className="button-outline" onClick={() => { void navigator.clipboard.writeText(campaign.gameId); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }}>{copied ? <Check size={15}/> : <ClipboardList size={15}/>} {copied ? 'Copié' : 'Copier l’ID'}</button></div><span className="invite-foot"><Shield size={13}/> Cet ID n’inclut aucune adresse IP.</span></section></div></>
}

