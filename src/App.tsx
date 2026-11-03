import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { supabase } from './supabase'
import {
  Activity, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Copy,
  ClipboardList, Coins, Compass, Dices, DoorOpen, Eye, EyeOff, Feather, Gamepad2, Globe2, Heart, Image as ImageIcon, LogOut,
  Home, LockKeyhole, Mail, MessageCircle, MonitorPlay, Plus, RefreshCw, ScrollText, Send, Settings, Shield, Sparkles, Swords, Trash2, TreePine, Upload, Users, X,
} from 'lucide-react'

type User = { id: number; email: string; username: string; displayName: string; role: 'gm' | 'player'; canGM?: boolean; mustChangePassword: boolean; authLinked: boolean }
type Campaign = { id: number; gameId: string; name: string; inviteCode: string | null; legacyJoinPassword?: string | null; joinPasswordSet: boolean; isOpen: boolean; status: 'active' | 'paused' | 'stopped'; criticalMode: 'positive' | 'negative'; isOwner: boolean }
type SessionData = { user: User; campaign: Campaign | null }
type Lobby = { id: number; gameId: string; name: string; isOpen: boolean; hostName: string; playerCount: number; createdAt: string }
type SocialProfile = { user_id: string; public_id: string; username: string; display_name: string }
type SocialFriendship = { user_low: string; user_high: string; created_at: string }
type SocialFriendRequest = { id: string; sender_id: string; recipient_id: string; status: 'pending' | 'accepted' | 'declined'; created_at: string }
type SocialGameInvitation = { id: string; sender_id: string; recipient_id: string; game_id: string; campaign_name: string; host_url: string; status: 'pending' | 'accepted' | 'declined' | 'cancelled'; created_at: string; expires_at: string }
type TunnelStatus = { status: 'stopped' | 'starting' | 'online' | 'stopping' | 'error'; publicUrl: string | null; error: string | null }
type UpdateStatus = { state: 'idle' | 'checking' | 'downloading' | 'current' | 'downloaded' | 'error' | 'unsupported'; version: string | null; percent: number; message: string; error: string | null; supported?: boolean }
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
type GameStroke = { id: string; color: string; width: number; points: { x: number; y: number }[] }
type GameToken = { id: number; imageId: number; name: string; color: string; x: number; y: number; assignedUserIds: number[] }
type GameOverlay = { strokes: GameStroke[]; tokens: GameToken[] }
type RollRequest = {
  id: string; target_user_id: number | null; target_group: boolean; target_name: string | null; character_id: number | null;
  character_name: string | null; action: string; stat: string; difficulty: number; stat_bonus: number;
  circumstance: number; context: string; expires_at: string | null; status: string; created_at: string;
  result: { detail: Roll['detail']; total: number; dice: number[]; player: string } | null;
}
type View = 'home' | 'game' | 'table' | 'character' | 'requests' | 'players' | 'friends' | 'settings' | 'selectCharacter'

const STAT_LIST = ['Force', 'Constitution', 'Agilité', 'Magie', 'Perception', 'Intelligence', 'Charisme']
const BONUS_POOL = [3, 2, 1, 1, 0, 0, 0]
const CHARACTER_KIND_LABEL: Record<Character['kind'], string> = { player: 'Héros', companion: 'Compagnon', npc: 'PNJ', monster: 'Monstre', other: 'Autre fiche MJ' }
const hasOfficialStats = (stats: Record<string, number>) => JSON.stringify(Object.values(stats).sort((a, b) => b-a)) === JSON.stringify([...BONUS_POOL].sort((a,b)=>b-a))
const STAT_HELP: Record<string, string> = {
  Force: 'Puissance physique, corps à corps et obstacles', Constitution: 'Endurance, résistance et poisons', Agilité: 'Réflexes, équilibre, discrétion et esquive',
  Magie: 'Phénomènes magiques et forces surnaturelles', Perception: 'Observation, dangers et traces', Intelligence: 'Connaissances, raisonnement et analyse', Charisme: 'Persuasion, négociation et tromperie',
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024
const INLINE_IMAGE_BYTES = 6 * 1024 * 1024
const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const api = async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(url, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init.headers } })
  const raw = await response.text().catch(() => '')
  let data: { error?: string } = {}
  try { data = raw ? JSON.parse(raw) : {} } catch { /* Keep the HTTP status when a proxy returns a non-JSON error page. */ }
  if (!response.ok) throw new Error(data.error || `La requête a échoué (HTTP ${response.status}).`)
  return data as T
}
async function prepareImageForUpload(file: File): Promise<{ name: string; contentType: string; blob: Blob }> {
  const extensionType: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const contentType = file.type.toLowerCase() || extensionType[extension] || ''
  if (!contentType.startsWith('image/')) throw new Error('Choisis un fichier image (JPG, PNG, GIF ou WebP).')
  if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('Le fichier dépasse 40 Mo. Réduis sa taille avant de l’ajouter.')
  if (contentType === 'image/gif') {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Un GIF animé doit faire 10 Mo maximum.')
    return { name: file.name, contentType, blob: file }
  }
  if (IMAGE_CONTENT_TYPES.includes(contentType) && file.size <= INLINE_IMAGE_BYTES) return { name: file.name, contentType, blob: file }

  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new Error('Ce format ne peut pas être lu ici. Convertis l’image en JPG, PNG ou WebP, puis réessaie.') }
  try {
    let scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height))
    let quality = 0.9
    for (let attempt = 0; attempt < 12; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Impossible de préparer cette image.')
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
      if (!blob) throw new Error('Impossible de compresser cette image.')
      if (blob.size <= MAX_IMAGE_BYTES) {
        const baseName = file.name.replace(/\.[^.]+$/, '') || 'image'
        return { name: `${baseName}.webp`, contentType: 'image/webp', blob }
      }
      if (quality > 0.66) quality -= 0.08
      else { scale *= 0.78; quality = 0.9 }
    }
  } finally { bitmap.close() }
  throw new Error('Cette image reste trop volumineuse après compression. Essaie une image plus petite.')
}
const errorMessage = (cause: unknown, fallback: string) => {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string' && cause) return cause
  if (cause && typeof cause === 'object') {
    const error = cause as { message?: unknown; details?: unknown }
    const parts = [error.message, error.details].filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    if (parts.length) return parts.join(' — ')
  }
  return fallback
}
const errorCode = (cause: unknown) => cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code: unknown }).code) : ''
const dateLabel = (raw: string) => new Date(`${raw.replace(' ', 'T')}${raw.includes('Z') ? '' : 'Z'}`).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const verdictLabel: Record<string, string> = { success: 'Réussite', failure: 'Échec', critical_success: 'Réussite critique', critical_failure: 'Échec critique' }
const verdictClass: Record<string, string> = { success: 'success', failure: 'failure', critical_success: 'critical-success', critical_failure: 'critical-failure' }
const criticalRuleDescription = (mode: Campaign['criticalMode']) => mode === 'negative'
  ? 'Règle négative · 1 réussite critique · 20 échec critique'
  : 'Règle positive · 20 réussite critique · 1 échec critique'

export default function App() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [view, setView] = useState<View>('home')
  const [viewHistory, setViewHistory] = useState<View[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null)
  const [rolls, setRolls] = useState<Roll[]>([])
  const [gameImages, setGameImages] = useState<GameImage[]>([])
  const [overlayRevision, setOverlayRevision] = useState(0)
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
    if (window.location.hash.includes('type=recovery')) { setInitializing(false); return }
    api<SessionData>('/api/me').then((data) => {
      setSession(data)
      setCampaignHome(data.user.role === 'gm' && (!data.campaign || data.campaign.status !== 'active'))
      setView(data.user.mustChangePassword ? 'settings' : data.user.role === 'player' ? data.campaign ? 'selectCharacter' : 'home' : 'home')
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
    next.on('game:overlay:updated', () => setOverlayRevision((revision) => revision + 1))
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
    setView(data.user.mustChangePassword ? 'settings' : data.user.role === 'player' ? data.campaign ? 'selectCharacter' : 'home' : data.campaign ? 'home' : 'settings')
  }
  const onCampaignSelected = (campaign: Campaign) => {
    setCampaignHome(false)
    setViewHistory([])
    setSession((current) => current ? { ...current, campaign } : current)
    setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setLoadingData(true); setCreatingCharacter(false)
    setView(session?.user.role === 'player' ? 'selectCharacter' : 'home')
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
  if (session.user.mustChangePassword) return <><MainMenuActions onMenu={signOut} onSignOut={signOut}/><SettingsView user={session.user} campaign={session.campaign} forced onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setCampaignHome(user.role === 'gm' && (!campaign || campaign.status !== 'active')); setViewHistory([]); setView(user.role === 'gm' && !campaign ? 'settings' : user.role === 'player' ? campaign ? 'selectCharacter' : 'home' : 'home') }} onCampaignSelected={onCampaignSelected} onCampaignDeleted={() => undefined} onToast={setToast} /></>
  if (!session.campaign || campaignHome) {
    if (session.user.role === 'gm') return <><MainMenuActions onMenu={signOut} onSignOut={signOut}/><CampaignCreateScreen user={session.user} onSelected={onCampaignSelected} onCreated={(campaign, joinPassword) => { setCampaignHome(false); setSession((current) => current ? { ...current, campaign } : current); setLastJoinPassword(joinPassword); setViewHistory([]); setView('home') }} /></>
    if (!session.campaign && view === 'home') return <DashboardHome
      user={session.user} campaign={null} character={null} members={[]} friendsReady={session.user.authLinked}
      gameImages={[]} rolls={[]} socketConnected={false}
      onNavigate={(next) => { if (next === 'home' || next === 'friends' || next === 'settings') navigateTo(next); else setToast('Rejoins une campagne pour accéder à cette rubrique.') }}
      onSignOut={() => void signOut()} onRoll={() => undefined} notify={setToast} toast={toast} clearToast={() => setToast('')}
    />
    return <PlayerSocialHome user={session.user} page={view === 'settings' ? 'settings' : view === 'friends' ? 'friends' : 'home'} onPage={(next) => setView(next)} onSignOut={() => void signOut()} onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setView(campaign ? 'selectCharacter' : 'home') }} onToast={setToast} />
  }

  const isGM = session.user.role === 'gm'
  const ownCharacter = activeCharacter
  const pending = requests.filter((request) => request.status === 'pending' && (isGM || request.target_user_id === session.user.id || request.target_group)).length
  if (view === 'home') return <DashboardHome
    user={session.user}
    campaign={session.campaign}
    character={ownCharacter}
    members={members}
    friendsReady={session.user.authLinked}
    gameImages={gameImages}
    rolls={rolls.slice(0, 12)}
    socketConnected={Boolean(socket?.connected)}
    onNavigate={navigateTo}
    onSignOut={() => void signOut()}
    onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal partagé.')).catch((error) => setToast(error.message))}
    notify={setToast}
    toast={toast}
    clearToast={() => setToast('')}
  />
  const nav: { id: View; label: string; icon: typeof Dices; badge?: number }[] = [
    { id: 'home', label: 'Accueil', icon: Home },
    { id: 'game', label: 'Game', icon: MonitorPlay },
    { id: 'table', label: 'La table', icon: Dices },
    { id: 'character', label: 'Personnage', icon: BookOpen },
    ...(isGM ? [{ id: 'requests' as View, label: 'Requêtes de test', icon: ClipboardList, badge: pending }] : [{ id: 'requests' as View, label: 'Tests demandés', icon: ClipboardList, badge: pending }]),
    { id: 'players', label: 'Participants', icon: Users },
    { id: 'friends', label: 'Amis', icon: Users },
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
        {!loadingData && view === 'selectCharacter' && characters.length === 0 && <CharacterView user={session.user} characters={characters} members={members} forceNew onSaved={(character) => { setCharacters([character]); setActiveCharacter(character); setCreatingCharacter(false); navigateTo('home') }} onToast={setToast} />}
        {!loadingData && view === 'selectCharacter' && characters.length > 0 && <CharacterPickerView characters={characters} activeCharacter={activeCharacter} onSelect={async (character) => { try { const chosen = await api<Character>('/api/active-character', { method: 'POST', body: JSON.stringify({ characterId: character.id }) }); setActiveCharacter(chosen); navigateTo('home') } catch (error) { setToast(error instanceof Error ? error.message : 'Choix impossible.') } }} onCreate={() => { setCreatingCharacter(true); navigateTo('character') }} />}
        {!loadingData && view === 'game' && <GameView isGM={isGM} userId={session.user.id} members={members} overlayRevision={overlayRevision} campaignStatus={session.campaign.status} criticalMode={session.campaign.criticalMode} character={ownCharacter} images={gameImages} rolls={rolls.slice(0, 6)} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal de jeu.')).catch((e) => setToast(e.message))} onUpload={async (payload) => { const image = await api<GameImage>('/api/game-images', { method: 'POST', body: JSON.stringify(payload) }); setGameImages((current) => [image, ...current]); setToast('Image ajoutée à la galerie de campagne.') }} onShow={async (image, isShown) => { const updated = await api<GameImage>(`/api/game-images/${image.id}`, { method: 'PATCH', body: JSON.stringify({ isShown }) }); setGameImages((current) => current.map((item) => item.id === updated.id ? updated : { ...item, isShown: isShown ? false : item.isShown })); setToast(isShown ? 'Image affichée aux joueurs.' : 'Image retirée de l’écran des joueurs.') }} onDelete={async (image) => { await api(`/api/game-images/${image.id}`, { method: 'DELETE' }); setGameImages((current) => current.filter((item) => item.id !== image.id)); setToast('Image supprimée de la galerie.') }} />}
        {!loadingData && view === 'table' && <TableView session={{ ...session, campaign: session.campaign! }} isGM={isGM} ownCharacter={ownCharacter} members={members} rolls={rolls} requests={requests} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal partagé.')).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onGo={navigateTo} />}
        {!loadingData && view === 'character' && <CharacterView user={session.user} characters={characters} members={members} activeCharacter={activeCharacter} forceNew={creatingCharacter} onCreateNew={() => setCreatingCharacter(true)} onCancelCreate={() => setCreatingCharacter(false)} onActiveCharacter={setActiveCharacter} onSaved={(character) => { setCharacters((current) => [character, ...current.filter((v) => v.id !== character.id)]); if (session.user.role === 'player') { setActiveCharacter(character); setCreatingCharacter(false); navigateTo('home') } else setCreatingCharacter(false) }} onToast={setToast} />}
        {view === 'requests' && <RequestsView isGM={isGM} campaignStatus={session.campaign.status} userId={session.user.id} members={members} characters={characters} requests={requests} onCreate={(payload) => api<RollRequest>('/api/requests', { method: 'POST', body: JSON.stringify(payload) }).then((request) => { setRequests((current) => [request, ...current.filter((v) => v.id !== request.id)]); setToast('La demande de test a été envoyée.') }).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onCancel={(id) => api<RollRequest>(`/api/requests/${id}/cancel`, { method: 'POST' }).then((request) => setRequests((current) => current.map((v) => v.id === id ? request : v))).catch((e) => setToast(e.message))} />}
        {!loadingData && view === 'players' && <PlayersView members={members} campaign={session.campaign} />}
        {view === 'friends' && <FriendsView user={session.user} campaign={session.campaign} onGoSettings={() => navigateTo('settings')} onToast={setToast} />}
        {!loadingData && view === 'settings' && <SettingsView user={session.user} campaign={session.campaign} lastJoinPassword={lastJoinPassword} onJoinPasswordChanged={setLastJoinPassword} onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setToast('Profil enregistré.'); if (!campaign && user.role === 'gm') navigateTo('table') }} onCampaignSelected={onCampaignSelected} onCampaignDeleted={(deletedId, nextCampaign) => { if (session.campaign?.id === deletedId) { setSession({ user: session.user, campaign: nextCampaign }); setCampaignHome(!nextCampaign || nextCampaign.status !== 'active'); setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setGameImages([]); setLoadingData(Boolean(nextCampaign)) } }} onToast={setToast} />}
      </div>
    </main>
    {toast && <div className="toast"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="Fermer"><X size={15} /></button></div>}
  </div>
}

function DashboardHome({ user, campaign, character, members, friendsReady, gameImages, rolls, socketConnected, onNavigate, onSignOut, onRoll, notify, toast, clearToast }: {
  user: User; campaign: Campaign | null; character: Character | null; members: Member[]; friendsReady: boolean;
  gameImages: GameImage[]; rolls: Roll[]; socketConnected: boolean; onNavigate: (view: View) => void;
  onSignOut: () => void; onRoll: (payload: object) => void; notify: (message: string) => void; toast: string; clearToast: () => void;
}) {
  const [friends, setFriends] = useState<SocialProfile[]>([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [friendsError, setFriendsError] = useState('')
  const [diceSides, setDiceSides] = useState(20)
  const [diceCount, setDiceCount] = useState(1)
  const [rolling, setRolling] = useState(false)
  const [avatarKey, setAvatarKey] = useState(`local:${user.id}`)
  const [avatarSrc, setAvatarSrc] = useState('/profile-default.png')
  const avatarInput = useRef<HTMLInputElement>(null)
  const isGM = user.role === 'gm'
  const social = supabase as any
  const featuredImage = campaign ? isGM ? (gameImages.find((image) => image.isShown) || gameImages[0]) : gameImages.find((image) => image.isShown) : undefined
  const onlineFriends = friends.filter((friend) => members.some((member) => member.online && member.displayName.toLocaleLowerCase() === friend.display_name.toLocaleLowerCase())).length

  useEffect(() => {
    let disposed = false
    const load = async () => {
      setFriendsLoading(true); setFriendsError('')
      if (!friendsReady) { setFriends([]); setFriendsLoading(false); return }
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        if (authError || !authData.user) throw new Error('Reconnecte le compte en ligne dans Réglages pour afficher tes amis.')
        const uid = authData.user.id
        const [{ error: syncError }, { data: links, error: linksError }] = await Promise.all([
          social.rpc('sync_my_social_profile', { p_username: user.username, p_display_name: user.displayName }),
          social.from('social_friendships').select('user_low,user_high').or(`user_low.eq.${uid},user_high.eq.${uid}`),
        ])
        if (syncError) throw syncError
        if (linksError) throw linksError
        const friendIds = ((links || []) as SocialFriendship[]).map((link) => link.user_low === uid ? link.user_high : link.user_low)
        if (!friendIds.length) { if (!disposed) setFriends([]); return }
        const { data, error: profilesError } = await social.from('social_profiles').select('user_id,public_id,username,display_name').in('user_id', friendIds)
        if (profilesError) throw profilesError
        if (!disposed) setFriends((data || []) as SocialProfile[])
      } catch (cause) {
        if (!disposed) setFriendsError(errorMessage(cause, 'Impossible de charger la liste d’amis.'))
      } finally { if (!disposed) setFriendsLoading(false) }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 30000)
    return () => { disposed = true; window.clearInterval(refresh) }
  }, [friendsReady, user.id, user.username, user.displayName])

  useEffect(() => {
    let disposed = false
    const loadAvatar = async () => {
      let key = `local:${user.id}`
      if (user.authLinked) {
        try {
          const { data } = await supabase.auth.getUser()
          if (data.user?.id) key = data.user.id
        } catch { /* The local account key remains available while Supabase is offline. */ }
      }
      if (disposed) return
      setAvatarKey(key)
      try { setAvatarSrc(localStorage.getItem(`yuta.profile-avatar.${key}`) || '/profile-default.png') }
      catch { setAvatarSrc('/profile-default.png') }
    }
    void loadAvatar()
    return () => { disposed = true }
  }, [user.id, user.authLinked])

  async function changeAvatar(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify('Choisis un fichier image.'); return }
    if (file.size > 20 * 1024 * 1024) { notify('L’image doit faire moins de 20 Mo.'); return }
    try {
      const image = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      const size = 384
      canvas.width = size; canvas.height = size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Impossible de préparer cette image.')
      const scale = Math.max(size / image.width, size / image.height)
      const width = image.width * scale; const height = image.height * scale
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height)
      image.close()
      const result = canvas.toDataURL('image/webp', 0.86)
      localStorage.setItem(`yuta.profile-avatar.${avatarKey}`, result)
      setAvatarSrc(result)
      notify('Photo de profil mise à jour.')
    } catch { notify('Cette image ne peut pas être utilisée. Essaie un fichier JPG ou PNG.') }
  }

  function rollDice() {
    if (!campaign || campaign.status !== 'active' || rolling) return
    setRolling(true)
    onRoll({ count: diceCount, sides: diceSides, modifier: 0, characterId: character?.id ?? null })
    window.setTimeout(() => setRolling(false), 650)
  }

  const categories: { label: string; target: View }[] = [
    { label: 'Accueil', target: 'home' }, { label: 'Campagne', target: 'game' }, { label: 'Fiches', target: 'character' },
    { label: 'Ressources', target: 'table' }, { label: 'Amis', target: 'friends' }, { label: 'Paramètres', target: 'settings' },
  ]

  return <div className={`home-screen ${isGM ? 'home-gm' : 'home-player'}`}>
    <div className="home-artboard">
    <button className="home-profile-picture" onClick={() => avatarInput.current?.click()} aria-label="Modifier la photo de profil" title="Cliquer pour changer ma photo de profil">
      <img src={avatarSrc} alt={`Photo de profil de ${user.displayName}`} />
    </button>
    <img className="home-backdrop" src={isGM ? '/home-mj-bg.png' : '/home-player-bg.png'} alt="" />
    <nav className="home-category-nav" aria-label="Menu principal">
      {categories.map(({ label, target }) => <button key={target} className={target === 'home' ? 'home-category active' : 'home-category'} onClick={() => onNavigate(target)} aria-label={label} title={label}><span className="sr-only">{label}</span></button>)}
    </nav>

    <input ref={avatarInput} className="home-avatar-input" type="file" accept="image/*" onChange={(event) => { void changeAvatar(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
    <div className="home-profile-name" title={user.displayName}>{user.displayName}<small>{isGM ? 'Maître du Jeu' : character?.name || 'Joueur'}</small></div>
    <section className="home-campaign-panel" aria-label="Campagne en cours">
      <header className="home-panel-title"><span className="home-title-icon"><ScrollText size={18}/></span><h1>Campagne en cours</h1>{campaign && <span className={`home-campaign-state ${campaign.status}`}>{campaign.status === 'active' ? 'EN COURS' : campaign.status === 'paused' ? 'EN PAUSE' : 'ARRÊTÉE'}</span>}</header>
      {campaign ? <div className={`home-campaign-feature ${featuredImage ? 'has-image' : ''}`}>
        {featuredImage ? <img src={featuredImage.url} alt={featuredImage.name} /> : <div className="home-feature-placeholder"><Compass/><span>Le carnet de campagne</span></div>}
        <div className="home-feature-shade" />
        <div className="home-feature-copy"><h2>{campaign.name}</h2><p>{character ? `En route avec ${character.name}` : isGM ? 'Votre aventure vous attend.' : 'Choisis une fiche pour rejoindre l’aventure.'}</p></div>
        <button className="home-resume-button" onClick={() => onNavigate('game')}><ArrowUpRight size={15}/><span>Reprendre</span></button>
      </div> : <div className="home-no-campaign"><BookOpen size={27}/><strong>Aucune campagne en cours</strong><span>Tu pourras rejoindre une campagne depuis tes invitations, dans l’onglet Amis.</span></div>}
    </section>

    <section className="home-dice-panel" aria-label="Lancer de dés et historique">
      <header className="home-panel-title"><span className="home-title-icon"><Dices size={18}/></span><h2>Lancer des dés</h2><span className="home-critical-rule">{campaign ? campaign.criticalMode === 'positive' ? '20 CRITIQUE' : '1 CRITIQUE' : 'CAMPAGNE REQUISE'}</span></header>
      <div className="home-dice-options" role="group" aria-label="Choisir un dé">
        {[4, 6, 8, 10, 12, 20, 100].map((sides) => <button key={sides} className={diceSides === sides ? 'home-die-option selected' : 'home-die-option'} onClick={() => setDiceSides(sides)} aria-pressed={diceSides === sides}><span className="home-die-glyph">{sides === 20 ? '◇' : sides === 4 ? '△' : sides === 6 ? '⬡' : '✧'}</span><small>D{sides}</small></button>)}
      </div>
      <div className="home-dice-actions">
        <div className="home-dice-count"><span>Nombre :</span><button aria-label="Retirer un dé" onClick={() => setDiceCount((count) => Math.max(1, count - 1))}>−</button><strong>{diceCount}</strong><button aria-label="Ajouter un dé" onClick={() => setDiceCount((count) => Math.min(20, count + 1))}>＋</button></div>
        <button className={`home-roll-button ${rolling ? 'rolling' : ''}`} disabled={!campaign || campaign.status !== 'active' || rolling} onClick={rollDice}><Dices size={16}/><span>{rolling ? 'Lancer…' : 'Lancer'}</span></button>
        <button className="home-history-link" onClick={() => onNavigate('table')} aria-label="Voir tous les lancers" title="Voir tout l’historique"><ArrowUpRight size={15}/></button>
      </div>
      <div className="home-roll-history">
        <div className="home-history-title"><span><ScrollText size={14}/> Historique des jets</span><small>{rolls.length ? 'EN DIRECT' : 'EN ATTENTE'}</small></div>
        <div className="home-roll-list">
          {rolls.length ? rolls.slice(0, 4).map((roll) => <RollItem key={roll.id} roll={roll} criticalMode={campaign?.criticalMode ?? 'positive'}/>) : <div className="home-no-rolls"><Dices size={16}/><span>Les résultats des dés s’afficheront ici.</span></div>}
        </div>
      </div>
    </section>

    <section className="home-friends-panel" aria-label="Amis">
      <header className="home-panel-title"><span className="home-title-icon"><Users size={19}/></span><h2>Amis ({friends.length})</h2><span className="home-friends-online"><i/>{onlineFriends} en ligne</span><button className="home-friends-open" onClick={() => onNavigate('friends')} aria-label="Ouvrir la liste d’amis" title="Ouvrir la liste complète"><ArrowUpRight size={16}/></button></header>
      {!friendsReady ? <button className="home-friends-empty" onClick={() => onNavigate('friends')}><Users size={22}/><strong>Lier ton compte pour retrouver tes amis</strong><span>La liste et les invitations se règlent dans l’onglet Amis.</span></button>
        : friendsLoading ? <div className="home-friends-empty"><Sparkles size={18}/><span>Chargement de la liste d’amis…</span></div>
        : friendsError ? <button className="home-friends-empty" onClick={() => onNavigate('friends')}><Users size={22}/><strong>La liste complète est dans Amis</strong><span>Ouvre cet onglet pour actualiser ou vérifier la connexion.</span></button>
        : friends.length === 0 ? <button className="home-friends-empty" onClick={() => onNavigate('friends')}><UserPlusHome/><strong>Pas encore d’amis ajoutés</strong><span>Ajoute tes compagnons depuis la page Amis.</span></button>
        : <div className="home-friend-list">{friends.map((friend) => {
          const member = members.find((item) => item.displayName.toLocaleLowerCase() === friend.display_name.toLocaleLowerCase())
          const status = member?.online ? 'En ligne' : member ? 'Absent' : 'Hors campagne'
          return <div className="home-friend-row" key={friend.user_id} role="button" tabIndex={0} onClick={() => onNavigate('friends')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onNavigate('friends') } }}>
            <span className="home-friend-avatar">{friend.display_name.slice(0, 1).toLocaleUpperCase()}</span>
            <span className="home-friend-info"><strong>{friend.display_name}</strong><small><i className={member?.online ? 'online' : member ? 'away' : ''}/>{status}</small></span>
            <span className="home-friend-id">{friend.public_id}</span>
            <span className="home-friend-actions"><button type="button" aria-label={`Ouvrir les options de ${friend.display_name}`} title="Options de l’ami" onClick={(event) => { event.stopPropagation(); onNavigate('friends') }}><MessageCircle size={16}/></button><button type="button" aria-label={`Gérer les invitations avec ${friend.display_name}`} title="Invitations" onClick={(event) => { event.stopPropagation(); onNavigate('friends') }}><Send size={15}/></button></span>
          </div>
        })}</div>}
    </section>

    <div className="home-status" title={socketConnected ? 'Synchronisation multijoueur connectée' : !campaign ? 'Compte joueur connecté' : 'Connexion à la table en cours'}><span className={socketConnected || !campaign ? 'online' : ''}/>{socketConnected ? 'SYNCHRONISÉ' : !campaign ? 'COMPTE CONNECTÉ' : 'CONNEXION À LA TABLE'}</div>
    <button className="home-signout" onClick={onSignOut} title="Se déconnecter"><LogOut size={16}/><span>Déconnexion</span></button>
    </div>
    {toast && <div className="toast home-toast"><Check size={16}/>{toast}<button onClick={clearToast} aria-label="Fermer"><X size={15}/></button></div>}
  </div>
}

function UserPlusHome() { return <span className="home-empty-friends-icon"><Users size={20}/><span>＋</span></span> }

function MainMenuActions({ onMenu, onSignOut }: { onMenu: () => void; onSignOut: () => void }) {
  return <div className="flow-global-actions"><button className="topbar-nav-button" onClick={onMenu}><DoorOpen size={15}/><span>Menu principal</span></button><button className="topbar-nav-button logout" onClick={onSignOut}><LogOut size={15}/><span>Déconnexion</span></button></div>
}

function WelcomeFlow({ onAuthenticated }: { onAuthenticated: (data: SessionData) => void }) {
  const inviteParams = new URLSearchParams(window.location.search)
  const inviteGameId = inviteParams.get('game')?.trim() || ''
  const socialInvitationId = inviteParams.get('invite')?.trim() || ''
  const [step, setStep] = useState<'auth' | 'mode' | 'lobbies' | 'join' | 'recover'>(() => window.location.hash.includes('type=recovery') ? 'recover' : 'auth')
  const [authenticated, setAuthenticated] = useState<SessionData | null>(null)
  const [selectedLobby, setSelectedLobby] = useState<Lobby | null>(null)
  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [lobbySearch, setLobbySearch] = useState(inviteGameId)
  const [register, setRegister] = useState(false)
  const [identifier, setIdentifier] = useState(() => { try { return localStorage.getItem('yuta.loginIdentifier') || '' } catch { return '' } })
  const [remember, setRemember] = useState(() => { try { return Boolean(localStorage.getItem('yuta.loginIdentifier')) } catch { return false } })
  const [showPassword, setShowPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const recovery = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const access = recovery.get('access_token')
    const refresh = recovery.get('refresh_token')
    if (recovery.get('type') === 'recovery' && access && refresh) {
      supabase.auth.setSession({ access_token: access, refresh_token: refresh }).then(({ error: sessionError }) => {
        if (sessionError) setError('Le lien de réinitialisation a expiré. Demande-en un nouveau.')
      })
    }
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setInfo(''); setBusy(true)
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      if (register) {
        const email = String(values.email || '').trim().toLowerCase()
        const role = 'player'
        const { data: signedUp, error: signUpError } = await supabase.auth.signUp({
          email, password: String(values.password || ''),
          options: { data: { role, username: String(values.username || ''), displayName: String(values.displayName || '') } },
        })
        if (signUpError) throw new Error(signUpError.message)
        if (!signedUp.session) {
          setRegister(false)
          setIdentifier(email)
          setRemember(true)
          try { localStorage.setItem('yuta.loginIdentifier', email) } catch { /* Remembering the address is optional. */ }
          setInfo('Compte joueur créé. Confirme ton adresse e-mail, puis connecte-toi pour choisir ton espace.')
          return
        }
        const data = await api<SessionData>('/api/auth/register', { method: 'POST', body: JSON.stringify({
          accessToken: signedUp.session.access_token, email, username: values.username, displayName: values.displayName, role,
        }) })
        setAuthenticated(data)
        setRegister(false)
        setStep('mode')
      } else {
        const loginIdentifier = String(values.identifier || '').trim()
        if (loginIdentifier.includes('@')) {
          const email = loginIdentifier.toLowerCase()
          const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password: String(values.password || '') })
          if (signInError || !signedIn.session) throw new Error(signInError?.message || 'Connexion impossible.')
          const metadataRole = signedIn.user.user_metadata?.role
          const initialRole = metadataRole === 'gm' ? 'gm' : 'player'
          let data: SessionData
          try { data = await api<SessionData>('/api/auth/login', { method: 'POST', body: JSON.stringify({ accessToken: signedIn.session.access_token, role: initialRole }) }) }
          catch (cause) { await supabase.auth.signOut(); throw cause }
          setAuthenticated(data)
        } else {
          const data = await api<SessionData>('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: loginIdentifier, password: String(values.password || '') }) })
          setAuthenticated(data)
        }
        if (remember) { try { localStorage.setItem('yuta.loginIdentifier', loginIdentifier) } catch { /* Remembering the address is optional. */ } }
        else { try { localStorage.removeItem('yuta.loginIdentifier') } catch { /* Remembering the address is optional. */ } }
        setStep('mode')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Connexion impossible.') }
    finally { setBusy(false) }
  }

  async function chooseMode(nextMode: 'gm' | 'player') {
    setBusy(true); setError(''); setInfo('')
    try {
      if (!authenticated) throw new Error('Ta session a expiré. Reconnecte-toi.')
      if (nextMode === 'gm' && !authenticated.user.canGM) throw new Error('Ce compte ne possède pas les droits Maître du Jeu.')
      const data = await api<SessionData>('/api/auth/mode', { method: 'POST', body: JSON.stringify({ role: nextMode }) })
      setAuthenticated(data)
      if (nextMode === 'player' && inviteGameId) {
        const found = await api<Lobby[]>(`/api/lobbies?gameId=${encodeURIComponent(inviteGameId)}`)
        setLobbies(found)
        if (found[0]) { setSelectedLobby(found[0]); setStep('join') }
        else { setLobbySearch(inviteGameId); setStep('lobbies'); setError('La partie indiquée est introuvable ou hors ligne.') }
        return
      }
      onAuthenticated(data)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de choisir cet espace.') }
    finally { setBusy(false) }
  }

  async function refreshLobbies() {
    setBusy(true); setError('')
    try { setLobbies(await api<Lobby[]>(`/api/lobbies${lobbySearch.trim() ? `?gameId=${encodeURIComponent(lobbySearch.trim())}` : ''}`)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de chercher les parties.') }
    finally { setBusy(false) }
  }

  async function joinLobby(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedLobby) return
    setBusy(true); setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget).entries())
    try {
      const { data: auth } = await supabase.auth.getSession()
      await api(`/api/campaigns/${selectedLobby.id}/join`, { method: 'POST', body: JSON.stringify({
        joinPassword: values.joinPassword || undefined, invitationId: socialInvitationId || undefined,
        accessToken: auth.session?.access_token,
      }) })
      onAuthenticated(await api<SessionData>('/api/me'))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de rejoindre cette partie.') }
    finally { setBusy(false) }
  }

  async function sendPasswordReset() {
    setError(''); setInfo('')
    const email = identifier.trim().toLowerCase()
    if (!email.includes('@')) { setError('Saisis ton adresse e-mail pour recevoir un lien de réinitialisation.'); return }
    setBusy(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      if (resetError) throw new Error(resetError.message)
      setInfo('Si cette adresse possède un compte, un lien de réinitialisation vient de lui être envoyé.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible d’envoyer le lien de réinitialisation.') }
    finally { setBusy(false) }
  }

  async function updatePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setInfo('')
    if (newPassword.length < 10) { setError('Le nouveau mot de passe doit contenir au moins 10 caractères.'); return }
    if (newPassword !== confirmPassword) { setError('Les deux mots de passe ne correspondent pas.'); return }
    setBusy(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw new Error(updateError.message)
      await supabase.auth.signOut()
      window.history.replaceState(null, '', window.location.pathname)
      setNewPassword(''); setConfirmPassword(''); setStep('auth'); setInfo('Mot de passe modifié. Tu peux maintenant te connecter.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier le mot de passe.') }
    finally { setBusy(false) }
  }

  const card = (children: React.ReactNode, extraClass = '') => <section className={`role-card auth-card ${extraClass}`}><img className="login-frame-art" src="/connexion-frame.png" alt=""/><div className="login-card-inner">{children}</div></section>
  const visibleLobbies = lobbies.filter((lobby) => `${lobby.gameId} ${lobby.name} ${lobby.hostName}`.toLowerCase().includes(lobbySearch.toLowerCase().trim()))
  return <div className="welcome-screen"><div className="welcome-scenic" aria-hidden="true"><img src="/connexion-background.png" alt=""/><div className="welcome-scenic-shade"/></div><main className="welcome-body">
    {step === 'auth' && card(<>
      <h1 className="login-title">{register ? 'Créer votre compte' : 'Connexion à votre compte'}</h1><div className="login-title-divider"><span>✥</span></div>
      <form onSubmit={submit} className={`auth-form ${register ? 'register-form' : ''}`}>
        {register && <><label>Pseudo de connexion<input name="username" minLength={2} maxLength={24} placeholder="Ex. Mira" required autoComplete="username"/></label><label>Pseudo affiché<input name="displayName" minLength={2} maxLength={40} placeholder="Comment t’appelle-t-on ?" required autoComplete="nickname"/></label><label>Adresse e-mail<input name="email" type="email" placeholder="toi@exemple.fr" required autoComplete="email"/></label></>}
        {!register && <label className="auth-icon-field"><Mail size={19}/><input name="identifier" type="text" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="Adresse e-mail" required autoComplete="username" aria-label="Adresse e-mail ou ancien pseudo"/></label>}
        <label className={register ? 'register-password-field' : 'auth-icon-field'}>{register ? <span>Mot de passe</span> : <LockKeyhole size={19}/>}<input name="password" type={showPassword ? 'text' : 'password'} minLength={register ? 10 : 1} placeholder="Mot de passe" required autoComplete={register ? 'new-password' : 'current-password'}/>{!register && <button className="password-visibility" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button>}</label>
        {!register && <div className="login-options"><label className="remember-option"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)}/> <span>Se souvenir de moi</span></label><button type="button" className="forgot-link" onClick={() => void sendPasswordReset()} disabled={busy}>Mot de passe oublié ?</button></div>}
        {info && <div className="form-info" role="status"><CircleHelp size={15}/><span>{info}</span></div>}{error && <div className="form-error">{error}</div>}
        <button className="button-primary auth-submit" disabled={busy}>{busy ? 'Patiente…' : register ? 'Créer mon compte' : <><DoorOpen size={19}/> Se connecter</>} {!busy && <ArrowUpRight size={16}/>}</button>
      </form>
      {!register && <div className="login-or"><span/>ou<span/></div>}
      <div className="login-signup">{register ? <>Déjà un compte ? <button className="text-link" onClick={() => { setRegister(false); setError(''); setInfo('') }}>Se connecter</button></> : <>Pas encore de compte ? <button className="text-link" onClick={() => { setRegister(true); setError(''); setInfo('') }}>S’inscrire</button></>}</div>
    </>, register ? 'auth-form-card registering' : 'auth-form-card')}
    {step === 'mode' && card(<>
      <h1 className="login-title">Choisis ton espace</h1><div className="login-title-divider"><span>✥</span></div><p className="mode-intro">Comment veux-tu jouer aujourd’hui ?</p>
      <div className="mode-image-buttons">
        <button className="mode-image-button gm" disabled={busy || !authenticated?.user.canGM} onClick={() => void chooseMode('gm')} aria-label="Choisir le mode Maître du Jeu" title={authenticated?.user.canGM ? 'Mode Maître du Jeu' : 'Ce compte ne possède pas les droits MJ'}><img src="/mode-mj.png" alt="Maître du Jeu — Créez et gérez vos campagnes"/></button>
        <button className="mode-image-button player" disabled={busy} onClick={() => void chooseMode('player')} aria-label="Choisir le mode Joueur" title="Mode Joueur"><img src="/mode-joueur.png" alt="Joueur — Rejoignez une campagne et vivez l’aventure"/></button>
      </div>
      {error && <div className="form-error">{error}</div>}<div className="login-account-note">{authenticated ? `Connecté en tant que ${authenticated.user.displayName}` : 'Compte authentifié'}</div>
    </>, 'mode-picker-card')}
    {step === 'lobbies' && card(<>
      <button className="back-link" onClick={() => setStep('mode')}><ArrowLeft size={14}/> Choisir un autre espace</button><h1 className="login-title">Rejoindre une partie</h1><div className="login-title-divider"><span>✥</span></div><p className="mode-intro">Saisis l’ID transmis par le MJ, puis actualise la liste.</p><label className="lobby-search-label">ID de partie<input value={lobbySearch} onChange={(event) => setLobbySearch(event.target.value)} placeholder="Ex. Y11-4F2A…"/></label><button className="button-outline refresh-lobbies" onClick={() => void refreshLobbies()} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/>{busy ? 'Recherche…' : 'Actualiser les parties'}</button>{error && <div className="form-error">{error}</div>}<div className="lobby-list">{visibleLobbies.map((lobby) => <button className="lobby-row" key={lobby.id} onClick={() => { setSelectedLobby(lobby); setStep('join'); setError('') }}><span className="lobby-glyph"><Gamepad2 size={17}/></span><span><strong>{lobby.name}</strong><small>{lobby.gameId} · MJ {lobby.hostName} · {lobby.playerCount} participant{lobby.playerCount === 1 ? '' : 's'}</small></span><ChevronRight size={16}/></button>)}</div>
    </>, 'lobby-card')}
    {step === 'join' && selectedLobby && card(<>
      <button className="back-link" onClick={() => setStep('lobbies')}><ArrowLeft size={14}/> Retour aux parties</button><h1 className="login-title">{selectedLobby.name}</h1><div className="login-title-divider"><span>✥</span></div><p className="mode-intro">Partie hébergée par {selectedLobby.hostName} · {selectedLobby.gameId}</p>
      <form className="auth-form join-form" onSubmit={joinLobby}>{!socialInvitationId && <label>Mot de passe de la partie<input name="joinPassword" type="password" minLength={8} maxLength={200} placeholder="Mot de passe transmis par le MJ" required autoComplete="off"/></label>}{error && <div className="form-error">{error}</div>}<button className="button-primary auth-submit" disabled={busy}>{busy ? 'Connexion…' : 'Rejoindre la partie'} <ArrowUpRight size={16}/></button></form>
    </>, 'join-card')}
    {step === 'recover' && card(<>
      <h1 className="login-title">Nouveau mot de passe</h1><div className="login-title-divider"><span>✥</span></div><p className="mode-intro">Choisis un nouveau mot de passe pour ton compte.</p><form className="auth-form recovery-form" onSubmit={updatePassword}><label>Nouveau mot de passe<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={10} required autoComplete="new-password"/></label><label>Confirmer le mot de passe<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={10} required autoComplete="new-password"/></label>{error && <div className="form-error">{error}</div>}<button className="button-primary auth-submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Changer mon mot de passe'} <Check size={16}/></button></form>
    </>, 'recovery-card')}
  </main></div>
}

function CampaignCreateScreen({ user, onSelected, onCreated }: { user: User; onSelected: (campaign: Campaign) => void; onCreated: (campaign: Campaign, joinPassword: string) => void }) {
  const [name, setName] = useState('Yuta et les 11')
  const [joinPassword, setJoinPassword] = useState('')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => undefined) }, [])
  async function openCampaign(id: number) {
    setBusy(true); setError('')
    try { onSelected((await api<{ campaign: Campaign }>(`/api/campaigns/${id}/select`, { method: 'POST' })).campaign) }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossible d’ouvrir la campagne.') }
    finally { setBusy(false) }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try { const campaign = await api<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name, joinPassword }) }); setCampaigns((current) => [campaign, ...current]); onCreated(campaign, joinPassword) }
    catch (e) { setError(e instanceof Error ? e.message : 'Création impossible.') }
    finally { setBusy(false) }
  }
  return <div className="setup-screen"><div className="setup-card"><div className="setup-emblem"><Sparkles size={24}/></div><div className="eyebrow">BONJOUR {user.displayName.toUpperCase()} · ESPACE MJ</div><h1>Pose les premières<br/><em>pierres du récit.</em></h1><p>Crée une campagne et choisis son mot de passe. Les joueurs rejoindront ta partie avec le lien en ligne et ce mot de passe.</p>{campaigns.length > 0 && <section className="campaign-home-list"><div className="eyebrow">VOS CAMPAGNES</div>{campaigns.map((item) => <div className="campaign-home-row" key={item.id}><span><strong>{item.name}</strong><small>{item.status === 'active' ? 'En cours' : item.status === 'paused' ? 'En pause' : 'Arrêtée'} · {item.gameId}</small></span><button type="button" className="button-outline" onClick={() => void openCampaign(item.id)} disabled={busy}>Ouvrir</button></div>)}</section>}<form onSubmit={submit}><label>Nom de la campagne<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required/></label><label>Mot de passe de la partie<input type="password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} minLength={8} maxLength={200} placeholder="8 caractères minimum" autoComplete="new-password" required/></label>{error && <div className="form-error">{error}</div>}<button className="button-primary" disabled={busy}><Plus size={16}/>{busy ? 'Patiente…' : 'Créer la campagne'}<ArrowUpRight size={15}/></button></form><div className="role-footer"><Shield size={14}/> Transmets le mot de passe séparément du lien d’accès.</div></div></div>
}

function CharacterPickerView({ characters, activeCharacter, onSelect, onCreate }: { characters: Character[]; activeCharacter: Character | null; onSelect: (character: Character) => void; onCreate: () => void }) {
  return <div className="character-pick-screen"><div className="eyebrow">AVANT DE REPARTIR À L’AVENTURE</div><h1>Qui incarnes-tu <em>aujourd’hui ?</em></h1><p className="muted">Choisis un héros ou un compagnon confié par le MJ.</p><div className="character-pick-grid">{characters.map((character) => <button className={`character-pick-card ${activeCharacter?.id === character.id ? 'chosen' : ''}`} key={character.id} onClick={() => onSelect(character)}><span className="character-pick-art">{character.portrait ? <img src={character.portrait} alt={`Portrait de ${character.name}`}/> : <Sparkles size={21}/>}</span><strong>{character.name}</strong><span>{CHARACTER_KIND_LABEL[character.kind || 'player']} · {character.species || 'Voyageur'} · {character.origin || 'Origine inconnue'}</span><i><Heart size={13}/> {character.hp_current}/{character.hp_max} PV</i><b>Jouer ce personnage <ChevronRight size={15}/></b></button>)}</div><button className="new-character-button" onClick={onCreate}><Plus size={16}/> Créer un autre personnage</button></div>
}

function SettingsView({ user, campaign, forced = false, lastJoinPassword = '', onJoinPasswordChanged = () => undefined, onUserUpdated, onCampaignSelected, onCampaignDeleted, onToast }: { user: User; campaign: Campaign | null; forced?: boolean; lastJoinPassword?: string; onJoinPasswordChanged?: (password: string) => void; onUserUpdated: (user: User, campaign: Campaign | null) => void; onCampaignSelected: (campaign: Campaign) => void; onCampaignDeleted: (id: number, nextCampaign: Campaign | null) => void; onToast: (message: string) => void }) {
  const [username, setUsername] = useState(user.username)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [campaignName, setCampaignName] = useState(campaign?.name || '')
  const [isOpen, setIsOpen] = useState(campaign?.isOpen ?? true)
  const [criticalMode, setCriticalMode] = useState<'positive' | 'negative'>(campaign?.criticalMode ?? 'positive')
  const [joinPassword, setJoinPassword] = useState(lastJoinPassword || campaign?.legacyJoinPassword || '')
  const [tunnel, setTunnel] = useState<TunnelStatus>({ status: 'stopped', publicUrl: null, error: null })
  const [tunnelBusy, setTunnelBusy] = useState(false)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [newCampaignName, setNewCampaignName] = useState('')
  const [newCampaignPassword, setNewCampaignPassword] = useState('')
  const [campaignBusy, setCampaignBusy] = useState(false)
  const [campaignError, setCampaignError] = useState('')
  const [supabaseEmail, setSupabaseEmail] = useState(user.email !== 'yuta@local.invalid' ? user.email : '')
  const [supabasePassword, setSupabasePassword] = useState('')
  const [supabaseMode, setSupabaseMode] = useState<'existing' | 'create'>('existing')
  const [supabaseError, setSupabaseError] = useState('')
  const [supabaseInfo, setSupabaseInfo] = useState('')
  const [supabaseBusy, setSupabaseBusy] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: 'unsupported', version: null, percent: 0, message: 'Les mises à jour sont disponibles dans l’application installée.', error: null })
  const [updateBusy, setUpdateBusy] = useState(false)
  useEffect(() => {
    setCampaignName(campaign?.name || '')
    setIsOpen(campaign?.isOpen ?? true)
    setCriticalMode(campaign?.criticalMode ?? 'positive')
  }, [campaign?.id, campaign?.name, campaign?.isOpen, campaign?.criticalMode])
  useEffect(() => {
    if (forced) return
    api<Campaign[]>('/api/campaigns').then(setCampaigns).catch(() => undefined)
  }, [forced, user.id])
  useEffect(() => {
    if (forced || user.role !== 'gm' || !campaign) return
    let disposed = false
    let timer: number | undefined
    const refreshTunnel = async () => {
      try {
        const next = await api<TunnelStatus>('/api/tunnel')
        if (disposed) return
        setTunnel(next)
        if (next.status === 'starting' || next.status === 'stopping') timer = window.setTimeout(() => void refreshTunnel(), 1000)
      } catch { /* Settings can still be edited when online access is unavailable. */ }
    }
    void refreshTunnel()
    return () => { disposed = true; if (timer) window.clearTimeout(timer) }
  }, [campaign?.id, forced, tunnel.status, user.role])
  useEffect(() => { if (lastJoinPassword) setJoinPassword(lastJoinPassword) }, [lastJoinPassword])
  useEffect(() => {
    const updater = window.yutaUpdater
    if (!updater) return
    let active = true
    const unsubscribe = updater.onStatus((status) => { if (active) setUpdateStatus(status) })
    updater.getStatus().then((status) => { if (active) setUpdateStatus(status) }).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [])
  async function checkForUpdates() {
    if (!window.yutaUpdater) return
    setUpdateBusy(true)
    try { setUpdateStatus(await window.yutaUpdater.check()) }
    catch { setUpdateStatus((current) => ({ ...current, state: 'error', message: 'La recherche de mise à jour a échoué.' })) }
    finally { setUpdateBusy(false) }
  }
  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    if (newPassword && newPassword !== confirmPassword) return setError('Les deux nouveaux mots de passe ne correspondent pas.')
    if (forced && !newPassword) return setError('Choisis un nouveau mot de passe avant de continuer.')
    setBusy(true)
    try {
      if (user.authLinked && newPassword) {
        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword })
        if (passwordError) throw new Error(passwordError.message)
      }
      const updated = await api<SessionData>('/api/account', { method: 'PATCH', body: JSON.stringify({ username, displayName, currentPassword: user.authLinked ? undefined : currentPassword, newPassword: user.authLinked ? null : newPassword || null }) })
      onUserUpdated(updated.user, updated.campaign)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier le profil.') }
    finally { setBusy(false) }
  }
  async function linkSupabase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSupabaseError(''); setSupabaseInfo(''); setSupabaseBusy(true)
    try {
      const email = supabaseEmail.trim().toLowerCase()
      if (supabaseMode === 'create') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email, password: supabasePassword,
          options: { data: { username, displayName } },
        })
        if (signUpError) throw new Error(signUpError.message)
        if (!data.session) {
          setSupabaseMode('existing')
          setSupabaseInfo('Confirme ton adresse e-mail, puis reviens ici en mode « J’ai déjà un compte » pour terminer la liaison.')
          setSupabasePassword('')
          return
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: supabasePassword })
        if (signInError) throw new Error(signInError.message)
      }
      const { data: auth } = await supabase.auth.getSession()
      if (!auth.session) throw new Error('Aucune session Supabase active. Reconnecte-toi puis réessaie.')
      const updated = await api<SessionData>('/api/auth/link-supabase', { method: 'POST', body: JSON.stringify({ accessToken: auth.session.access_token }) })
      onUserUpdated(updated.user, updated.campaign)
      setSupabasePassword(''); setSupabaseError('')
      setSupabaseInfo('Compte Supabase lié. Tu peux maintenant te connecter avec ton adresse e-mail et ce mot de passe.')
    } catch (e) { setSupabaseError(e instanceof Error ? e.message : 'Impossible de lier le compte Supabase.') }
    finally { setSupabaseBusy(false) }
  }
  async function saveCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    try {
      const updated = await api<Campaign>('/api/campaign', { method: 'PATCH', body: JSON.stringify({ name: campaignName, isOpen, joinPassword, status: campaign?.status, criticalMode }) })
      onUserUpdated(user, updated)
      setCampaignName(updated.name); setIsOpen(updated.isOpen); setCriticalMode(updated.criticalMode)
      setCampaigns((current) => current.map((item) => item.id === updated.id ? updated : item))
      if (joinPassword) onJoinPasswordChanged(joinPassword)
      onToast(joinPassword ? 'La partie et son mot de passe sont enregistrés.' : 'Les réglages de la partie sont enregistrés.')
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossible de modifier la partie.') }
    finally { setBusy(false) }
  }
  async function changeCampaignStatus(status: Campaign['status']) {
    if (!campaign) return
    setCampaignBusy(true); setCampaignError('')
    try {
      const updated = await api<Campaign>('/api/campaign', { method: 'PATCH', body: JSON.stringify({ name: campaignName, isOpen, joinPassword: '', status }) })
      setCampaigns((current) => current.map((item) => item.id === updated.id ? updated : item))
      setCampaignName(updated.name); setIsOpen(updated.isOpen); setCriticalMode(updated.criticalMode)
      onUserUpdated(user, updated)
      onToast(status === 'active' ? 'Campagne reprise.' : status === 'paused' ? 'Campagne mise en pause.' : 'Campagne arrêtée.')
    } catch (e) { setCampaignError(e instanceof Error ? e.message : 'Impossible de modifier l’état de la campagne.') }
    finally { setCampaignBusy(false) }
  }
  async function selectCampaign(id: number) {
    setCampaignBusy(true); setCampaignError('')
    try {
      const result = await api<{ campaign: Campaign }>(`/api/campaigns/${id}/select`, { method: 'POST' })
      onCampaignSelected(result.campaign)
    } catch (e) { setCampaignError(e instanceof Error ? e.message : 'Impossible d’ouvrir cette campagne.') }
    finally { setCampaignBusy(false) }
  }
  async function deleteCampaign(item: Campaign) {
    if (!window.confirm(`Supprimer « ${item.name} » et toutes ses données (personnages, lancers et images) ? Cette action est définitive.`)) return
    setCampaignBusy(true); setCampaignError('')
    try {
      const result = await api<{ campaign: Campaign | null }>(`/api/campaigns/${item.id}`, { method: 'DELETE' })
      setCampaigns((current) => current.filter((candidate) => candidate.id !== item.id))
      onCampaignDeleted(item.id, result.campaign)
      onToast(`Campagne « ${item.name} » supprimée.`)
    } catch (e) { setCampaignError(e instanceof Error ? e.message : 'Impossible de supprimer cette campagne.') }
    finally { setCampaignBusy(false) }
  }
  async function createCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCampaignBusy(true); setCampaignError('')
    try {
      const created = await api<Campaign>('/api/campaigns', { method: 'POST', body: JSON.stringify({ name: newCampaignName, joinPassword: newCampaignPassword }) })
      setCampaigns((current) => [created, ...current])
      onCampaignSelected(created)
    } catch (e) { setCampaignError(e instanceof Error ? e.message : 'Impossible de créer la campagne.') }
    finally { setCampaignBusy(false) }
  }
  async function changeTunnel() {
    setTunnelBusy(true)
    try {
      const action = tunnel.status === 'online' || tunnel.status === 'starting' ? 'stop' : 'start'
      const next = await api<TunnelStatus>(`/api/tunnel/${action}`, { method: 'POST' })
      setTunnel(next)
      if (next.status === 'starting') onToast('Création du lien sécurisé en cours…')
      if (next.status === 'error' && next.error) onToast(next.error)
    } catch (e) { onToast(e instanceof Error ? e.message : 'Impossible de modifier le lien en ligne.') }
    finally { setTunnelBusy(false) }
  }
  const gameUrl = tunnel.status === 'online' && tunnel.publicUrl && campaign ? `${tunnel.publicUrl}/?game=${encodeURIComponent(campaign.gameId)}` : ''
  async function copyText(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); onToast(`${label} copié.`) }
    catch { onToast('Le presse-papiers n’est pas accessible sur cet appareil.') }
  }
  return <><div className="welcome-row"><div><div className="eyebrow">TON ESPACE</div><h1>{forced ? <>Un mot de passe <em>à toi.</em></> : <>Réglages du <em>compte</em></>}</h1><p className="muted">{forced ? 'Choisis un nouveau mot de passe pour sécuriser le compte MJ.' : 'Modifie ton pseudo ou ton mot de passe.'}</p></div></div><div className="settings-grid"><section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">PROFIL</div><h2>Informations de connexion</h2></div><span className="subtle-icon"><Settings size={17}/></span></div><form className="settings-form" onSubmit={saveAccount}><label>Pseudo de connexion<input value={username} onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={24} required/></label><label>Pseudo affiché<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} minLength={2} maxLength={40} required/></label>{!user.authLinked && <label>Mot de passe actuel<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={forced ? 'Mot de passe temporaire' : 'Pour confirmer les changements'} required/></label>}<label>{forced ? 'Nouveau mot de passe' : user.authLinked ? 'Nouveau mot de passe Supabase (facultatif)' : 'Nouveau mot de passe (facultatif)'}<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={newPassword || forced ? 10 : undefined} maxLength={200} placeholder="10 caractères minimum" required={forced}/></label>{(newPassword || forced) && <label>Confirmer le nouveau mot de passe<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={10} required/></label>}{error && <div className="form-error">{error}</div>}<button className="button-primary" disabled={busy}><Check size={15}/>{busy ? 'Enregistrement…' : forced ? 'Sécuriser mon compte' : 'Enregistrer le profil'}<ArrowUpRight size={15}/></button></form></section>
    {!forced && <section className="panel settings-panel updater-panel"><div className="panel-heading"><div><div className="eyebrow">APPLICATION</div><h2>Mises à jour</h2></div><span className="subtle-icon"><RefreshCw size={17}/></span></div><p className="muted">Vérifie et télécharge une nouvelle version ici. L’installation s’effectue au prochain redémarrage, quand tu le décides.</p><div className={`update-status ${updateStatus.state}`}><i/>{updateStatus.message}</div>{updateStatus.state === 'downloading' && <div className="update-progress"><span style={{ width: `${Math.max(0, Math.min(100, updateStatus.percent))}%` }}/></div>}{updateStatus.state === 'error' && updateStatus.error && <small className="update-error-detail">{updateStatus.error}</small>}<div className="update-actions"><button type="button" className="button-outline" onClick={() => void checkForUpdates()} disabled={updateBusy || ['checking', 'downloading'].includes(updateStatus.state)}><RefreshCw size={14} className={updateBusy || updateStatus.state === 'checking' ? 'spin' : ''}/>{updateBusy || updateStatus.state === 'checking' ? 'Recherche…' : 'Rechercher une mise à jour'}</button>{updateStatus.state === 'downloaded' && <button type="button" className="button-primary" onClick={() => void window.yutaUpdater?.install()}><RefreshCw size={14}/>Redémarrer et installer</button>}</div></section>}
    {!forced && campaign && user.role === 'gm' && <>
      <section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">ESPACE MJ</div><h2>Campagne et session</h2></div><span className="subtle-icon"><ScrollText size={17}/></span></div><form className="settings-form" onSubmit={saveCampaign}><label>Nom de la campagne<input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} maxLength={80} required/></label><label className="session-toggle"><input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)}/><span><strong>Partie visible aux joueurs</strong><small>{isOpen ? 'Visible dans la liste depuis le lien du MJ.' : 'Masquée de la liste ; le lien direct reste valable.'}</small></span></label><div className="session-code"><span>ID DE PARTIE</span><strong>{campaign.gameId}</strong></div><label>Règle des coups critiques<select className="critical-mode-select" value={criticalMode} onChange={(event) => setCriticalMode(event.target.value as 'positive' | 'negative')}><option value="positive">Positive</option><option value="negative">Négative</option></select><small className="critical-mode-note">{criticalMode === 'positive' ? '20 = réussite critique · 1 = échec critique.' : '1 = réussite critique · 20 = échec critique.'}</small></label><label>Nouveau mot de passe de partie<input type="password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} minLength={joinPassword ? 8 : undefined} maxLength={200} placeholder={campaign.joinPasswordSet ? 'Laisser vide pour conserver' : '8 caractères minimum'} autoComplete="new-password"/></label>{campaign.legacyJoinPassword && <div className="legacy-password-note">Ancienne partie : son ancien code d’invitation fait office de mot de passe. Change-le ici pour le remplacer.</div>}{error && <div className="form-error">{error}</div>}<button className="button-primary" disabled={busy}><Check size={15}/>Enregistrer les réglages<ArrowUpRight size={15}/></button></form></section>
      <section className="panel settings-panel online-panel"><div className="panel-heading"><div><div className="eyebrow">ACCÈS À DISTANCE</div><h2>Héberger en ligne</h2></div><span className="subtle-icon"><Globe2 size={17}/></span></div><p className="online-description">Ouvre un lien sécurisé vers ton PC MJ. Les joueurs n’ont pas besoin de connaître ton adresse IP ni d’installer Hamachi.</p><div className={`tunnel-status ${tunnel.status}`}><i/>{tunnel.status === 'online' ? 'Partie joignable en ligne' : tunnel.status === 'starting' ? 'Création du lien en cours…' : tunnel.status === 'stopping' ? 'Fermeture du lien…' : tunnel.status === 'error' ? 'Le lien en ligne est indisponible' : 'Aucun lien en ligne actif'}</div>{tunnel.error && <div className="tunnel-error">{tunnel.error}</div>}{gameUrl && <><div className="online-url"><span>{gameUrl}</span><button className="button-outline" onClick={() => void copyText(gameUrl, 'Lien de partie')}><Copy size={14}/>Copier le lien</button></div><div className="online-password"><div><span>MOT DE PASSE DE PARTIE</span><strong>{lastJoinPassword || (campaign.legacyJoinPassword ?? 'Déjà défini — saisis-en un nouveau pour le modifier')}</strong></div>{lastJoinPassword && <button className="text-link" onClick={() => void copyText(lastJoinPassword, 'Mot de passe')}>Copier</button>}</div></>}{!gameUrl && <p className="online-note">Le lien est temporaire et change à chaque ouverture. Partage aussi le mot de passe de la partie, séparément.</p>}<button className={tunnel.status === 'online' || tunnel.status === 'starting' ? 'button-outline tunnel-button' : 'button-primary tunnel-button'} onClick={() => void changeTunnel()} disabled={tunnelBusy || tunnel.status === 'stopping'}><Globe2 size={15}/>{tunnelBusy ? 'Patiente…' : tunnel.status === 'online' || tunnel.status === 'starting' ? 'Fermer le lien en ligne' : 'Créer un lien en ligne'}</button><div className="tunnel-footnote"><Shield size={13}/> Le trafic passe par Cloudflare Tunnel. Le lien est public : seul le mot de passe autorise à rejoindre.</div></section>
    </>}{!forced && <section className="panel settings-panel campaign-manager-panel"><div className="panel-heading"><div><div className="eyebrow">VOS AVENTURES</div><h2>Campagnes</h2></div><span className="subtle-icon"><Compass size={17}/></span></div><div className="campaign-manager-list">{campaigns.map((item) => { const current = item.id === campaign?.id; const label = item.status === 'active' ? 'En cours' : item.status === 'paused' ? 'En pause' : 'Arrêtée'; return <article className={`campaign-manager-row ${item.status}`} key={item.id}><div className="campaign-manager-info"><strong>{item.name}</strong><span className={`campaign-state ${item.status}`}>{label}</span><small>{item.gameId}</small></div>{current ? <span className="campaign-current">Campagne ouverte</span> : <div className="campaign-actions"><button type="button" className="button-outline" onClick={() => void selectCampaign(item.id)} disabled={campaignBusy}>Ouvrir</button>{item.isOwner && <button type="button" className="button-quiet danger-text" onClick={() => void deleteCampaign(item)} disabled={campaignBusy} title="Supprimer cette campagne"><Trash2 size={14}/> Supprimer</button>}</div>}{current && item.isOwner && <div className="campaign-controls">{item.status === 'active' && <button type="button" className="button-outline" onClick={() => void changeCampaignStatus('paused')} disabled={campaignBusy}>Mettre en pause</button>}{item.status === 'paused' && <button type="button" className="button-primary" onClick={() => void changeCampaignStatus('active')} disabled={campaignBusy}>Reprendre</button>}{item.status !== 'stopped' && <button type="button" className="button-quiet danger-text" onClick={() => void changeCampaignStatus('stopped')} disabled={campaignBusy}>Arrêter</button>}{item.status === 'stopped' && <button type="button" className="button-primary" onClick={() => void changeCampaignStatus('active')} disabled={campaignBusy}>Réactiver</button>}<button type="button" className="button-quiet danger-text" onClick={() => void deleteCampaign(item)} disabled={campaignBusy} title="Supprimer cette campagne"><Trash2 size={14}/> Supprimer</button></div>}</article>})}{campaigns.length === 0 && <p className="muted campaign-empty">Aucune campagne trouvée.</p>}</div>{user.role === 'gm' && <form className="campaign-create-form" onSubmit={createCampaign}><div className="eyebrow">NOUVELLE AVENTURE</div><label>Nom de la campagne<input value={newCampaignName} onChange={(event) => setNewCampaignName(event.target.value)} minLength={2} maxLength={80} required placeholder="Ex. Les routes du Nord"/></label><label>Mot de passe de la partie<input type="password" value={newCampaignPassword} onChange={(event) => setNewCampaignPassword(event.target.value)} minLength={8} maxLength={200} required placeholder="8 caractères minimum" autoComplete="new-password"/></label>{campaignError && <div className="form-error">{campaignError}</div>}<button className="button-primary" disabled={campaignBusy}><Plus size={15}/>{campaignBusy ? 'Patiente…' : 'Créer une campagne'}<ArrowUpRight size={15}/></button></form>}</section>}</div></>
}

function GameView({ isGM, userId, members, overlayRevision, campaignStatus, criticalMode, character, images, rolls, onRoll, onUpload, onShow, onDelete }: {
  isGM: boolean; userId: number; members: Member[]; overlayRevision: number; campaignStatus: Campaign['status']; criticalMode: Campaign['criticalMode']; character: Character | null; images: GameImage[]; rolls: Roll[];
  onRoll: (payload: object) => void;
  onUpload: (payload: { name: string; contentType: string; data: string }) => Promise<void>;
  onShow: (image: GameImage, isShown: boolean) => Promise<void>;
  onDelete: (image: GameImage) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [overlay, setOverlay] = useState<GameOverlay>({ strokes: [], tokens: [] })
  const [tool, setTool] = useState<'pointer' | 'pen' | 'place'>('pointer')
  const [penColor, setPenColor] = useState('#f0c65e')
  const [penWidth, setPenWidth] = useState(4)
  const [draftStroke, setDraftStroke] = useState<GameStroke | null>(null)
  const [tokenEditorOpen, setTokenEditorOpen] = useState(false)
  const [tokenName, setTokenName] = useState('')
  const [tokenColor, setTokenColor] = useState('#d6b76f')
  const [tokenAssignees, setTokenAssignees] = useState<number[]>([])
  const [editingTokenId, setEditingTokenId] = useState<number | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeStroke = useRef<GameStroke | null>(null)
  const draggedToken = useRef<number | null>(null)
  const dragPosition = useRef<{ x: number; y: number } | null>(null)
  const shown = images.find((image) => image.isShown)
  const playerMembers = members.filter((member) => member.role === 'player')

  useEffect(() => {
    let cancelled = false
    if (!shown) { setOverlay({ strokes: [], tokens: [] }); return }
    api<GameOverlay>(`/api/game-images/${shown.id}/overlay`).then((next) => { if (!cancelled) setOverlay(next) }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Impossible de charger les annotations.') })
    return () => { cancelled = true }
  }, [shown?.id, overlayRevision])

  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame) return
    const draw = () => {
      const rect = frame.getBoundingClientRect()
      const scale = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * scale))
      canvas.height = Math.max(1, Math.round(rect.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.lineCap = 'round'; context.lineJoin = 'round'
      for (const stroke of [...overlay.strokes, ...(draftStroke ? [draftStroke] : [])]) {
        if (!stroke.points.length) continue
        context.strokeStyle = stroke.color; context.fillStyle = stroke.color; context.lineWidth = stroke.width
        const first = stroke.points[0]
        if (stroke.points.length === 1) { context.beginPath(); context.arc(first.x * rect.width, first.y * rect.height, Math.max(1, stroke.width / 2), 0, Math.PI * 2); context.fill(); continue }
        context.beginPath(); context.moveTo(first.x * rect.width, first.y * rect.height)
        for (const point of stroke.points.slice(1)) context.lineTo(point.x * rect.width, point.y * rect.height)
        context.stroke()
      }
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [overlay.strokes, draftStroke, shown?.id])

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setUploading(true); setError('')
    try {
      const prepared = await prepareImageForUpload(file)
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] || '') : reject(new Error('Lecture de l’image impossible.'))
        reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
        reader.readAsDataURL(prepared.blob)
      })
      await onUpload({ name: prepared.name, contentType: prepared.contentType, data: encoded })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible d’ajouter cette image.') }
    finally { setUploading(false) }
  }
  async function show(image: GameImage, isShown: boolean) {
    setError('')
    try { await onShow(image, isShown) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier l’affichage.') }
  }
  async function remove(image: GameImage) {
    if (!window.confirm(`Supprimer l’image « ${image.name} » de cette campagne ?`)) return
    setError('')
    try { await onDelete(image) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer cette image.') }
  }
  function normalizedPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return null
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  async function placeToken(point: { x: number; y: number }) {
    if (!shown) return
    try {
      const token = await api<GameToken>(`/api/game-images/${shown.id}/tokens`, { method: 'POST', body: JSON.stringify({ name: tokenName.trim() || 'Jeton', color: tokenColor, x: point.x, y: point.y, assignedUserIds: tokenAssignees }) })
      setOverlay((current) => ({ ...current, tokens: [...current.tokens.filter((item) => item.id !== token.id), token] }))
      setTokenEditorOpen(false); setTokenName(''); setTokenAssignees([]); setTool('pointer')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de placer ce jeton.') }
  }
  function beginPointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isGM || !shown) return
    const point = normalizedPointer(event)
    if (!point) return
    if (tool === 'place') { void placeToken(point); return }
    if (tool !== 'pen') return
    event.currentTarget.setPointerCapture(event.pointerId)
    activeStroke.current = { id: `draft-${Date.now()}`, color: penColor, width: penWidth, points: [point] }
    setDraftStroke(activeStroke.current)
  }
  function movePointer(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!activeStroke.current) return
    const point = normalizedPointer(event)
    if (!point) return
    activeStroke.current.points.push(point)
    setDraftStroke({ ...activeStroke.current, points: [...activeStroke.current.points] })
  }
  async function endPointer() {
    const stroke = activeStroke.current
    activeStroke.current = null
    setDraftStroke(null)
    if (!stroke || !shown) return
    try { await api(`/api/game-images/${shown.id}/strokes`, { method: 'POST', body: JSON.stringify({ color: stroke.color, width: stroke.width, points: stroke.points }) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible d’enregistrer le dessin.') }
  }
  async function clearDrawing() {
    if (!shown || !window.confirm('Effacer tous les dessins de cette image ?')) return
    try { await api(`/api/game-images/${shown.id}/strokes`, { method: 'DELETE' }); setOverlay((current) => ({ ...current, strokes: [] })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible d’effacer les dessins.') }
  }
  function beginTokenDrag(event: React.PointerEvent<HTMLButtonElement>, token: GameToken) {
    const canMove = isGM || token.assignedUserIds.includes(userId)
    if (!canMove || campaignStatus !== 'active' || (isGM && tool !== 'pointer')) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    draggedToken.current = token.id
    dragPosition.current = { x: token.x, y: token.y }
  }
  function moveToken(event: React.PointerEvent<HTMLElement>) {
    if (!draggedToken.current) return
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return
    const position = { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
    dragPosition.current = position
    setOverlay((current) => ({ ...current, tokens: current.tokens.map((token) => token.id === draggedToken.current ? { ...token, ...position } : token) }))
  }
  async function endTokenDrag() {
    const tokenId = draggedToken.current
    const position = dragPosition.current
    draggedToken.current = null; dragPosition.current = null
    if (tokenId === null || !position) return
    try { await api(`/api/game-tokens/${tokenId}`, { method: 'PATCH', body: JSON.stringify(position) }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de déplacer ce jeton.') }
  }
  async function saveToken() {
    if (!editingTokenId) return
    const current = overlay.tokens.find((token) => token.id === editingTokenId)
    if (!current) return
    try {
      const updated = await api<GameToken>(`/api/game-tokens/${current.id}`, { method: 'PATCH', body: JSON.stringify({ x: current.x, y: current.y, name: tokenName.trim() || 'Jeton', color: tokenColor, assignedUserIds: tokenAssignees }) })
      setOverlay((value) => ({ ...value, tokens: value.tokens.map((token) => token.id === updated.id ? updated : token) }))
      setEditingTokenId(null); setTokenName(''); setTokenAssignees([]); setTokenEditorOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de modifier ce jeton.') }
  }
  async function deleteToken(token: GameToken) {
    if (!window.confirm(`Supprimer le jeton « ${token.name} » ?`)) return
    try { await api(`/api/game-tokens/${token.id}`, { method: 'DELETE' }); setOverlay((value) => ({ ...value, tokens: value.tokens.filter((item) => item.id !== token.id) })); if (editingTokenId === token.id) setEditingTokenId(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Impossible de supprimer ce jeton.') }
  }
  function editToken(token: GameToken) {
    setEditingTokenId(token.id); setTokenName(token.name); setTokenColor(token.color); setTokenAssignees(token.assignedUserIds); setTokenEditorOpen(true)
  }
  return <>
    <div className="welcome-row game-welcome"><div><div className="eyebrow">ESPACE DE JEU EN DIRECT</div><h1>La scène <em>présente.</em></h1><p className="muted">Les images du MJ, vos lancers et les derniers résultats réunis ici.</p></div><span className={`session-tag ${campaignStatus}`}><i className={`status-dot ${campaignStatus === 'active' ? '' : 'offline'}`}/>{campaignStatus === 'active' ? 'SESSION ACTIVE' : campaignStatus === 'paused' ? 'EN PAUSE' : 'ARRÊTÉE'}</span></div>
    <div className="game-layout">
      <section className="panel game-stage-panel">
        <div className="panel-heading"><div><div className="eyebrow">CE QUE LA TABLE VOIT</div><h2>Écran de jeu</h2></div><span className="subtle-icon"><ImageIcon size={18}/></span></div>
        {shown ? <figure className="game-projection"><div className="game-scene-frame" ref={frameRef}><img src={shown.url} alt={shown.name}/><canvas ref={canvasRef} className={`game-annotation-canvas ${tool}`} style={{ pointerEvents: isGM && tool !== 'pointer' ? 'auto' : 'none' }} onPointerDown={beginPointer} onPointerMove={movePointer} onPointerUp={() => void endPointer()} onPointerCancel={() => void endPointer()} />{overlay.tokens.map((token) => { const movable = isGM || token.assignedUserIds.includes(userId); return <button key={token.id} type="button" className={`game-map-token ${movable && campaignStatus === 'active' ? 'movable' : ''} ${isGM && tool !== 'pointer' ? 'tool-locked' : ''}`} style={{ left: `${token.x * 100}%`, top: `${token.y * 100}%`, background: token.color, pointerEvents: !isGM || tool === 'pointer' ? 'auto' : 'none' }} title={`${token.name}${token.assignedUserIds.length ? ` · ${token.assignedUserIds.map((id) => members.find((member) => member.id === id)?.displayName || 'Joueur').join(', ')}` : ''}`} onPointerDown={(event) => beginTokenDrag(event, token)} onPointerMove={moveToken} onPointerUp={() => void endTokenDrag()} onPointerCancel={() => void endTokenDrag()}><span>{token.name.slice(0, 2).toLocaleUpperCase('fr-FR')}</span></button> })}</div><figcaption>{shown.name}</figcaption></figure> : <div className="game-projection-empty"><div className="game-projection-icon"><ImageIcon size={24}/></div><strong>{isGM ? 'Choisis une image à partager' : 'Le MJ prépare la scène'}</strong><span>{isGM ? 'Les joueurs ne verront que l’image affichée.' : 'La carte ou l’illustration choisie par le MJ apparaîtra ici.'}</span></div>}
        {isGM && <div className="game-image-tools"><label className={`button-primary game-upload-button ${uploading ? 'disabled' : ''}`}><Upload size={15}/>{uploading ? 'Préparation et envoi…' : 'Ajouter une image'}<input type="file" accept="image/*" onChange={(event) => void upload(event)} disabled={uploading}/></label><small>Images jusqu’à 40 Mo · compression automatique · GIF animé limité à 10 Mo.</small></div>}
        {isGM && shown && <div className="game-overlay-tools"><div className="game-tool-row"><button type="button" className={`button-outline ${tool === 'pointer' ? 'selected' : ''}`} onClick={() => setTool('pointer')}><Eye size={14}/>Déplacer</button><button type="button" className={`button-outline ${tool === 'pen' ? 'selected' : ''}`} onClick={() => setTool('pen')}><Feather size={14}/>Stylo</button><button type="button" className="button-outline" onClick={() => { setEditingTokenId(null); setTokenName(''); setTokenAssignees([]); setTokenEditorOpen((open) => !open) }}><Plus size={14}/>Ajouter un jeton</button><label className="game-color-control" title="Couleur du stylo"><input type="color" value={penColor} onChange={(event) => setPenColor(event.target.value)}/> Couleur</label><label className="game-width-control">Épaisseur <input type="range" min="1" max="12" value={penWidth} onChange={(event) => setPenWidth(Number(event.target.value))}/></label><button type="button" className="button-quiet danger-text" onClick={() => void clearDrawing()}>Effacer les dessins</button></div><div className="game-tool-hint">{tool === 'pen' ? 'Dessine directement sur l’image : les joueurs voient les traits en direct.' : tool === 'place' ? 'Clique sur l’image pour placer le nouveau jeton.' : 'Fais glisser un jeton pour le déplacer.'}</div>{overlay.tokens.length > 0 && <div className="game-token-manager"><strong>Jetons de la scène</strong>{overlay.tokens.map((token) => <div className="game-token-row" key={token.id}><span className="game-token-swatch" style={{ background: token.color }}/><button type="button" className="game-token-name" onClick={() => editToken(token)}>{token.name}<small>{token.assignedUserIds.length ? token.assignedUserIds.map((id) => members.find((member) => member.id === id)?.displayName || 'Joueur').join(', ') : 'Aucun joueur assigné'}</small></button><button className="icon-button" type="button" onClick={() => editToken(token)} aria-label="Modifier le jeton"><Settings size={14}/></button><button className="icon-button danger-text" type="button" onClick={() => void deleteToken(token)} aria-label="Supprimer le jeton"><Trash2 size={14}/></button></div>)}</div>}{tokenEditorOpen && <div className="game-token-editor"><div className="game-token-editor-heading"><strong>{editingTokenId ? 'Personnaliser le jeton' : 'Nouveau jeton'}</strong><button type="button" className="icon-button" onClick={() => { setTokenEditorOpen(false); setEditingTokenId(null) }} aria-label="Fermer"><X size={14}/></button></div><div className="game-token-form-row"><label>Nom du jeton<input value={tokenName} onChange={(event) => setTokenName(event.target.value)} maxLength={32} placeholder="Ex. Lysa, Garde, Loup…"/></label><label>Couleur<input type="color" value={tokenColor} onChange={(event) => setTokenColor(event.target.value)}/></label></div><div className="game-token-assignments"><span>Attribuer aux joueurs (plusieurs possibles)</span>{playerMembers.length ? playerMembers.map((member) => <label key={member.id}><input type="checkbox" checked={tokenAssignees.includes(member.id)} onChange={(event) => setTokenAssignees((ids) => event.target.checked ? [...ids, member.id] : ids.filter((id) => id !== member.id))}/>{member.displayName}</label>) : <small>Aucun joueur n’a encore rejoint la campagne.</small>}</div>{editingTokenId ? <button type="button" className="button-primary" onClick={() => void saveToken()}>Enregistrer le jeton</button> : <button type="button" className="button-primary" onClick={() => setTool('place')}><Plus size={14}/>Placer sur l’image</button>}</div>}</div>}
        {error && <div className="form-error game-error">{error}</div>}
        {isGM && <div className="game-image-library">{images.map((image) => <article className={`game-image-card ${image.isShown ? 'shown' : ''}`} key={image.id}><img src={image.url} alt=""/><div className="game-image-copy"><strong title={image.name}>{image.name}</strong><small>{Math.max(1, Math.round(image.byteSize / 1024))} Ko {image.isShown ? '· Visible' : ''}</small></div><button className="icon-button" type="button" onClick={() => void show(image, !image.isShown)} title={image.isShown ? 'Masquer aux joueurs' : 'Montrer aux joueurs'} aria-label={image.isShown ? 'Masquer aux joueurs' : 'Montrer aux joueurs'}>{image.isShown ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button className="icon-button danger-text" type="button" onClick={() => void remove(image)} title="Supprimer l’image" aria-label="Supprimer l’image"><Trash2 size={15}/></button></article>)}{images.length === 0 && <p className="game-library-empty">La galerie est vide. Ajoute une carte, un portrait ou une illustration pour la partager.</p>}</div>}
      </section>
      <aside className="game-side-column">
        <section className="panel game-dice-panel"><div className="panel-heading"><div><div className="eyebrow">LE HASARD TRANCHE</div><h2>Lancer les dés</h2></div><span className="subtle-icon"><Dices size={18}/></span></div><div className="critical-rule-note">{criticalRuleDescription(criticalMode)}</div>{campaignStatus === 'active' ? <><DiceControls character={character} onRoll={onRoll}/><CustomDice onRoll={onRoll}/></> : <div className="campaign-inactive-note"><Shield size={17}/><span>Les lancers reprendront quand le MJ relancera la campagne.</span></div>}</section>
        <section className="panel game-rolls-panel"><div className="game-rolls-heading"><div><div className="eyebrow">RÉSUMÉ DISCRET</div><h2>Derniers lancers</h2></div><span className="live-pill"><i/> LIVE</span></div><div className="game-roll-list">{rolls.length ? rolls.map((roll) => <RollItem key={roll.id} roll={roll} criticalMode={criticalMode}/>) : <p className="game-library-empty">Les prochains résultats apparaîtront ici.</p>}</div></section>
      </aside>
    </div>
  </>
}

function TableView({ session, isGM, ownCharacter, members, rolls, requests, onRoll, onResolve, onGo }: {
  session: SessionData & { campaign: Campaign }; isGM: boolean; ownCharacter: Character | null; members: Member[]; rolls: Roll[]; requests: RollRequest[];
  onRoll: (payload: object) => void; onResolve: (id: string) => void; onGo: (view: View) => void;
}) {
  const actionable = requests.filter((r) => r.status === 'pending' && !isGM && (r.target_user_id === session.user.id || r.target_group))
  return <>
    <div className="welcome-row"><div><div className="eyebrow">LE CERCLE SE RASSEMBLE</div><h1>Bienvenue à la table, <em>{session.user.displayName}</em></h1><p className="muted">Les histoires n’attendent qu’un premier lancer.</p></div><div className={`session-tag ${session.campaign.status}`}><span className={`status-dot ${session.campaign.status === 'active' ? '' : 'offline'}`}/> {session.campaign.status === 'active' ? 'SESSION ACTIVE' : session.campaign.status === 'paused' ? 'SESSION EN PAUSE' : 'SESSION ARRÊTÉE'}</div></div>
    {session.campaign.status === 'active' && actionable.length > 0 && <div className="urgent-request"><div className="urgent-icon"><ScrollText size={20}/></div><div className="urgent-copy"><span className="eyebrow">LE MAÎTRE DU JEU VOUS SOLLICITE</span><strong>{actionable.length === 1 ? actionable[0].action : `${actionable.length} tests en attente`}</strong><span>{actionable[0].stat} · Difficulté {actionable[0].difficulty} · Bonus +{actionable[0].stat_bonus}{actionable[0].context && ` · ${actionable[0].context}`}</span></div><button className="button-primary" onClick={() => onGo('requests')}>Voir le test <ArrowUpRight size={15}/></button></div>}
    <div className="overview-grid"><div className="overview-card"><div className="overview-icon gold"><Users size={18}/></div><div><span>À la table</span><strong>{members.filter((m) => m.online).length}<small> / {members.length}</small></strong></div><i className="card-ornament"/></div><div className="overview-card"><div className="overview-icon red"><Heart size={18}/></div><div><span>{ownCharacter ? 'Santé du personnage' : 'Votre personnage'}</span><strong>{ownCharacter ? <>{ownCharacter.hp_current}<small> / {ownCharacter.hp_max} PV</small></> : <small>À créer</small>}</strong></div><i className="card-ornament"/></div><div className="overview-card"><div className="overview-icon blue"><Dices size={18}/></div><div><span>Lancers partagés</span><strong>{rolls.length}<small> dans le journal</small></strong></div><i className="card-ornament"/></div></div>
    <div className="table-grid"><section className="panel dice-panel"><div className="panel-heading"><div><div className="eyebrow">LE HASARD TRANCHE</div><h2>À vous de jouer</h2></div><span className="subtle-icon"><Dices size={18}/></span></div><p className="muted panel-intro">Lancez librement, ou laissez le Maître du Jeu définir votre prochain défi.</p><div className="critical-rule-note">{criticalRuleDescription(session.campaign.criticalMode)}</div>{session.campaign.status === 'active' ? <><DiceControls character={ownCharacter} onRoll={onRoll}/><div className="divider-label"><span/> OU LANCEZ À VOTRE FAÇON <span/></div><CustomDice onRoll={onRoll}/></> : <div className="campaign-inactive-note"><Shield size={18}/><span>{session.campaign.status === 'paused' ? 'Les lancers reprendront quand le MJ relancera la campagne.' : 'Cette campagne est arrêtée. Le MJ peut la réactiver depuis Réglages.'}</span></div>}
      <div className="quick-links"><button onClick={() => onGo('character')}><BookOpen size={15}/> Fiche du personnage <ArrowUpRight size={14}/></button><button onClick={() => onGo('requests')}><ClipboardList size={15}/> {isGM ? 'Gérer les requêtes' : 'Mes tests demandés'} <ArrowUpRight size={14}/></button></div>
    </section><RollHistory rolls={rolls.slice(0, 9)} criticalMode={session.campaign.criticalMode}/></div>
    <div className="table-bottom-grid"><section className="panel compact-panel"><div className="panel-heading"><div><div className="eyebrow">VOTRE GROUPE</div><h2>À la table</h2></div><button className="text-link" onClick={() => onGo('players')}>Voir tous <ArrowUpRight size={14}/></button></div><div className="mini-members">{members.slice(0, 5).map((m) => <div className="mini-member" key={m.id}><div className="avatar">{m.displayName.slice(0,1).toUpperCase()}</div><div><strong>{m.displayName}</strong><span>{m.characterName || (m.role === 'gm' ? 'Maître du Jeu' : 'Pas de personnage')}</span></div><i className={m.online ? 'status-dot' : 'status-dot offline'}/></div>)}</div></section><section className="quote-card"><Sparkles size={17}/><p>« Chaque grand récit commence par une décision. »</p><span>LE CARNET DU VOYAGEUR</span></section></div>
  </>
}

function DiceControls({ character, onRoll }: { character: Character | null; onRoll: (payload: object) => void }) {
  const [busy, setBusy] = useState(false)
  return <button className={`d20-button ${busy ? 'rolling' : ''}`} disabled={busy} onClick={() => { setBusy(true); onRoll({ count: 1, sides: 20, modifier: 0, characterId: character?.id ?? null }); window.setTimeout(() => setBusy(false), 550) }}><span className="d20-die"><Dices size={27}/></span><span className="d20-label"><strong>Lancer 1D20</strong><small>{character ? `Pour ${character.name}` : 'Un lancer libre'}</small></span><ArrowUpRight size={18} className="d20-arrow"/></button>
}
function CustomDice({ onRoll }: { onRoll: (payload: object) => void }) {
  const [notation, setNotation] = useState('2d6+2')
  const [error, setError] = useState('')
  return <form className="custom-dice" onSubmit={(event) => { event.preventDefault(); const match = notation.trim().match(/^(\d{1,2})d(\d{1,4})(?:([+-])(\d{1,5}))?$/i); if (!match) return setError('Utilisez une notation comme 3d6+2.'); const count = Number(match[1]); const sides = Number(match[2]); const modifier = Number(`${match[3] || '+'}${match[4] || 0}`); if (count < 1 || count > 20 || sides < 2 || sides > 1000 || Math.abs(modifier) > 10000) return setError('Maximum 20 dés, 1 000 faces et un modificateur de 10 000.'); setError(''); onRoll({ notation }) }}><div className="notation-input"><Dices size={16}/><input aria-label="Notation des dés" value={notation} onChange={(e) => setNotation(e.target.value)} /><span>DÉS</span></div><button className="button-outline"><span>Lancer</span><ArrowUpRight size={14}/></button>{error && <span className="dice-error">{error}</span>}</form>
}

function RollHistory({ rolls, criticalMode }: { rolls: Roll[]; criticalMode: Campaign['criticalMode'] }) {
  return <section className="panel history-panel"><div className="panel-heading"><div><div className="eyebrow">JOURNAL DE LA CAMPAGNE</div><h2>Derniers lancers</h2></div><span className="live-pill"><i/> EN DIRECT</span></div><div className="roll-list">{rolls.length ? rolls.map((roll) => <RollItem key={roll.id} roll={roll} criticalMode={criticalMode}/>) : <div className="empty-state"><div className="empty-die"><Dices size={22}/></div><strong>Le silence avant le premier jet</strong><span>Les lancers de la table apparaîtront ici.</span></div>}</div></section>
}
function RollItem({ roll, criticalMode }: { roll: Roll; criticalMode: Campaign['criticalMode'] }) {
  const isD20 = roll.dice.length === 1 && /^1d20(?:[+-]\d+)?$/i.test(roll.notation)
  const natural = roll.detail?.natural ?? (isD20 ? roll.dice[0] : null)
  const freeVerdict = natural === (criticalMode === 'positive' ? 20 : 1) ? 'critical_success' : natural === (criticalMode === 'positive' ? 1 : 20) ? 'critical_failure' : null
  const verdict = roll.detail?.verdict || freeVerdict
  const critical = verdict === 'critical_success' ? 'natural-twenty' : verdict === 'critical_failure' ? 'natural-one' : ''
  return <div className={`roll-row ${critical}`}><div className="roll-mark"><Dices size={16}/></div><div className="roll-info"><strong>{roll.display_name}{roll.character_name ? <span> · {roll.character_name}</span> : null}</strong><small>{roll.detail ? `${roll.detail.action} · ${roll.detail.stat}` : roll.notation.toUpperCase()} <i>·</i> {dateLabel(roll.created_at)}</small></div><div className="roll-result"><span>{roll.dice.join(' + ')}{roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : ''}</span><strong>{roll.total}</strong></div>{roll.detail && <span className={`verdict-chip ${verdictClass[roll.detail.verdict]}`}>{verdictLabel[roll.detail.verdict]}</span>}{!roll.detail && freeVerdict && <span className={`verdict-chip ${verdictClass[freeVerdict]}`}>{verdictLabel[freeVerdict]}</span>}</div>
}

function CharacterView({ user, characters, members, activeCharacter = null, forceNew = false, onCreateNew, onCancelCreate, onActiveCharacter, onSaved, onToast }: { user: User; characters: Character[]; members: Member[]; activeCharacter?: Character | null; forceNew?: boolean; onCreateNew?: () => void; onCancelCreate?: () => void; onActiveCharacter?: (character: Character) => void; onSaved: (character: Character) => void; onToast: (message: string) => void }) {
  const isGM = user.role === 'gm'
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const own = characters.find((character) => character.owner_id === user.id)
  const selected = forceNew ? null : isGM ? characters.find((c) => c.id === selectedId) || characters[0] : characters.find((c) => c.id === selectedId) || activeCharacter || own
  const [form, setForm] = useState({ name: '', age: '', species: '', origin: '', description: '' })
  const [stats, setStats] = useState<Record<string, number>>(() => Object.fromEntries(STAT_LIST.map((v, index) => [v, BONUS_POOL[index]])))
  const [hpCurrent, setHpCurrent] = useState(20); const [hpMax, setHpMax] = useState(20); const [allowCustom, setAllowCustom] = useState(false)
  const [characterKind, setCharacterKind] = useState<Character['kind']>('player')
  const [assignedPlayerId, setAssignedPlayerId] = useState<number>(members.find((member) => member.role === 'player')?.id || 0)
  const [busy, setBusy] = useState(false)
  const [inventoryText, setInventoryText] = useState('')
  const [gold, setGold] = useState(0)
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const [pendingPortrait, setPendingPortrait] = useState<{ name: string; contentType: string; data: string; preview: string } | null>(null)
  useEffect(() => {
    setPendingPortrait(null)
    if (!selected) {
      if (forceNew) {
        setForm({ name: '', age: '', species: '', origin: '', description: '' })
        setStats(Object.fromEntries(STAT_LIST.map((v, index) => [v, BONUS_POOL[index]])))
        setHpCurrent(20); setHpMax(20); setAllowCustom(false); setInventoryText(''); setGold(0)
        setCharacterKind(isGM ? 'npc' : 'player')
        setAssignedPlayerId(members.find((member) => member.role === 'player')?.id || 0)
      }
      return
    }
    setForm({ name: selected.name, age: selected.age, species: selected.species, origin: selected.origin, description: selected.description })
    setStats(selected.stats); setHpCurrent(selected.hp_current); setHpMax(selected.hp_max); setInventoryText((selected.equipment || []).join('\n')); setGold(selected.gold ?? 0); setCharacterKind(selected.kind || 'player'); setAssignedPlayerId(selected.owner_id); setAllowCustom(!hasOfficialStats(selected.stats))
  }, [selected?.id, selected?.updated_at, forceNew])
  const validPool = useMemo(() => hasOfficialStats(stats), [stats])
  function edit(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })) }
  async function choosePortrait(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    try {
      const prepared = await prepareImageForUpload(file)
      const preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
        reader.readAsDataURL(prepared.blob)
      })
      setPendingPortrait({ name: prepared.name, contentType: prepared.contentType, data: preview.split(',')[1] || '', preview })
    } catch (error) { onToast(error instanceof Error ? error.message : 'Lecture de l’image impossible.') }
  }
  async function removePortrait() {
    if (pendingPortrait) { setPendingPortrait(null); return }
    if (!selected?.portrait) return
    try {
      const updated = await api<Character>(`/api/characters/${selected.id}/portrait`, { method: 'DELETE' })
      onSaved(updated); onToast('Portrait supprimé.')
    } catch (error) { onToast(error instanceof Error ? error.message : 'Impossible de supprimer le portrait.') }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true)
    try {
      const payload: Record<string, unknown> = { ...form }
      if (!selected) { payload.stats = stats; payload.hpCurrent = hpCurrent; payload.hpMax = hpMax; if (isGM) { payload.kind = characterKind; payload.ownerId = assignedPlayerId; payload.allowCustomStats = allowCustom } }
      if (isGM && selected) { payload.stats = stats; payload.hpCurrent = hpCurrent; payload.hpMax = hpMax; payload.allowCustomStats = allowCustom }
      let saved = await api<Character>(selected ? `/api/characters/${selected.id}` : '/api/characters', { method: selected ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      if (!selected && !isGM) await api('/api/active-character', { method: 'POST', body: JSON.stringify({ characterId: saved.id }) })
      if (pendingPortrait) {
        try {
          saved = await api<Character>(`/api/characters/${saved.id}/portrait`, { method: 'PUT', body: JSON.stringify({ name: pendingPortrait.name, contentType: pendingPortrait.contentType, data: pendingPortrait.data }) })
          setPendingPortrait(null)
        } catch (error) {
          setSelectedId(saved.id); onSaved(saved)
          onToast(`Fiche enregistrée, mais le portrait n’a pas pu être ajouté : ${error instanceof Error ? error.message : 'erreur inconnue.'}`)
          return
        }
      }
      setSelectedId(saved.id)
      onSaved(saved); onToast('Fiche enregistrée.')
    } catch (error) { onToast(error instanceof Error ? error.message : 'Enregistrement impossible.') }
    finally { setBusy(false) }
  }
  async function switchCharacter(id: number) {
    try {
      const chosen = await api<Character>('/api/active-character', { method: 'POST', body: JSON.stringify({ characterId: id }) })
      setSelectedId(id); onActiveCharacter?.(chosen); onToast(`Tu joues maintenant ${chosen.name}.`)
    } catch (error) { onToast(error instanceof Error ? error.message : 'Impossible de choisir ce personnage.') }
  }
  async function saveInventory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || !isGM) return
    const equipment = inventoryText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    if (equipment.length > 100 || equipment.some((item) => item.length > 120)) { onToast('Limite : 100 objets, 120 caractères par ligne.'); return }
    setInventoryBusy(true)
    try {
      const saved = await api<Character>(`/api/characters/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ equipment, gold }) })
      onSaved(saved); onToast('Inventaire et golds enregistrés.')
    } catch (error) { onToast(error instanceof Error ? error.message : 'Impossible d’enregistrer l’inventaire.') }
    finally { setInventoryBusy(false) }
  }
  return <><div className="welcome-row"><div><div className="eyebrow">LES HÉROS DE LA CAMPAGNE</div><h1>{isGM ? <>Fiches de <em>campagne</em></> : <>Fiche de <em>personnage</em></>}</h1><p className="muted">{isGM ? 'Crée et administre les héros, compagnons, PNJ et monstres.' : 'Ta fiche et les compagnons que le MJ t’a confiés.'}</p></div><div className="character-toolbar">{isGM && !forceNew && characters.length > 0 && <select className="character-select" value={selected?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))}>{characters.map((c) => <option value={c.id} key={c.id}>{members.find((m) => m.id === c.owner_id)?.displayName || 'MJ'} · {CHARACTER_KIND_LABEL[c.kind || 'player']} · {c.name}</option>)}</select>}{!isGM && !forceNew && characters.length > 1 && <select className="character-select" value={selected?.id ?? ''} onChange={(e) => void switchCharacter(Number(e.target.value))}>{characters.map((c) => <option value={c.id} key={c.id}>{CHARACTER_KIND_LABEL[c.kind || 'player']} · {c.name}</option>)}</select>}{isGM && forceNew && characters.length > 0 && <button type="button" className="button-outline" onClick={onCancelCreate}>Annuler</button>}{isGM && !forceNew && <button type="button" className="button-primary" onClick={onCreateNew}><Plus size={15}/> Nouvelle fiche</button>}{!isGM && !forceNew && <button type="button" className="button-primary" onClick={onCreateNew}><Plus size={15}/> Nouveau personnage</button>}</div></div>
    {!isGM && (!own || forceNew) && <div className="character-create-note"><Sparkles size={19}/><span>{own ? 'Ajoutez un nouveau héros à votre collection.' : 'Votre aventure commence par votre personnage. Répartissez les sept bonus officiels pour créer sa fiche.'}</span></div>}
    {isGM && !selected && !forceNew && <div className="empty-panel"><BookOpen size={27}/><strong>Aucune fiche pour le moment</strong><span>Crée un héros, un compagnon, un PNJ ou un monstre pour cette campagne.</span><button className="button-primary" onClick={onCreateNew}><Plus size={15}/> Créer une fiche</button></div>}
    {(selected || !isGM || (isGM && forceNew)) && <form className="character-layout" onSubmit={submit}><div className="panel character-main"><div className="panel-heading"><div><div className="eyebrow">{selected ? CHARACTER_KIND_LABEL[selected.kind || 'player'].toUpperCase() : isGM ? 'NOUVELLE FICHE' : 'IDENTITÉ'}</div><h2>{selected ? selected.name : 'Nouveau personnage'}</h2></div><span className="subtle-icon"><Feather size={17}/></span></div><div className="portrait-editor"><div className="portrait-preview">{pendingPortrait?.preview || selected?.portrait ? <img src={pendingPortrait?.preview || selected?.portrait} alt={`Portrait de ${selected?.name || form.name || 'ce personnage'}`}/> : <span><ImageIcon size={24}/><small>VISUEL DU PERSONNAGE</small></span>}</div><div className="portrait-controls"><strong>Portrait / illustration</strong><small>Images jusqu’à 40 Mo · compression automatique · GIF animé limité à 10 Mo</small><div><label className="button-outline portrait-upload-button"><Upload size={14}/>{pendingPortrait ? 'Changer l’image' : selected?.portrait ? 'Remplacer l’image' : 'Ajouter une image'}<input type="file" accept="image/*" onChange={(event) => void choosePortrait(event)}/></label>{(pendingPortrait || selected?.portrait) && <button type="button" className="button-quiet danger-text" onClick={() => void removePortrait()}>{pendingPortrait ? 'Annuler' : 'Supprimer'}</button>}</div>{pendingPortrait && <small className="portrait-pending-note">L’image sera enregistrée avec la fiche.</small>}</div></div>{isGM && !selected && <div className="character-kind-form"><label>Type de fiche<select value={characterKind} onChange={(event) => setCharacterKind(event.target.value as Character['kind'])}><option value="companion">Compagnon jouable</option><option value="npc">PNJ sous le contrôle du MJ</option><option value="monster">Monstre</option><option value="other">Autre fiche MJ</option></select></label>{characterKind === 'companion' && <label>Attribuer à<select value={assignedPlayerId || ''} onChange={(event) => setAssignedPlayerId(Number(event.target.value))} required><option value="">Choisir un joueur</option>{members.filter((member) => member.role === 'player').map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}<small>Les compagnons attribués apparaîtront dans la liste des personnages jouables du joueur.</small></div>}<div className="identity-grid"><label>Nom du personnage<input value={form.name} onChange={(e) => edit('name', e.target.value)} required minLength={2}/></label><label>Âge<input value={form.age} onChange={(e) => edit('age', e.target.value)} placeholder="Âge ou époque"/></label><label>Espèce<input value={form.species} onChange={(e) => edit('species', e.target.value)} placeholder="Humaine, elfe…"/></label><label>Origine<input value={form.origin} onChange={(e) => edit('origin', e.target.value)} placeholder="Région, peuple…"/></label></div><label className="wide-label">Description<textarea rows={5} value={form.description} onChange={(e) => edit('description', e.target.value)} placeholder="Apparence, tempérament, histoire…"/></label><div className="character-owner"><span className="avatar">{(selected?.name || form.name || user.displayName).slice(0,1).toUpperCase()}</span><span>{selected ? selected.kind === 'npc' || selected.kind === 'monster' || selected.kind === 'other' ? 'Sous le contrôle du' : 'Joué par' : characterKind === 'npc' || characterKind === 'monster' || characterKind === 'other' ? 'Sous le contrôle du' : 'Attribué à'} <strong>{selected ? members.find((member) => member.id === selected.owner_id)?.displayName || user.displayName : characterKind === 'companion' ? members.find((member) => member.id === assignedPlayerId)?.displayName || 'Choisir un joueur' : user.displayName}</strong></span></div></div>
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

function PlayerSocialHome({ user, page, onPage, onSignOut, onUserUpdated, onToast }: {
  user: User; page: 'home' | 'friends' | 'settings'; onPage: (page: 'home' | 'friends' | 'settings') => void; onSignOut: () => void;
  onUserUpdated: (user: User, campaign: Campaign | null) => void; onToast: (message: string) => void;
}) {
  return <div className="app-shell social-home-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Sparkles size={19}/></div><div><strong>Yuta et les 11</strong><span>ESPACE JOUEUR</span></div></div>
      <div className="side-label">VOTRE COMPTE</div>
      <nav className="side-nav">
        <button className={page === 'home' ? 'nav-item active' : 'nav-item'} onClick={() => onPage('home')}><DoorOpen size={17}/><span>Accueil</span></button>
        <button className={page === 'friends' ? 'nav-item active' : 'nav-item'} onClick={() => onPage('friends')}><Users size={17}/><span>Amis</span></button>
        <button className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => onPage('settings')}><Settings size={17}/><span>Réglages</span></button>
      </nav>
      <div className="sidebar-bottom"><div className="profile-row"><div className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{user.displayName}</strong><span>Joueur</span></div></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb">ESPACE JOUEUR <span>/</span> <strong>{page === 'friends' ? 'Amis' : page === 'settings' ? 'Réglages' : 'Accueil'}</strong></div><div className="top-actions"><button className="topbar-nav-button logout" onClick={onSignOut}><LogOut size={14}/><span>Déconnexion</span></button></div></header>
      <div className="page-content">{page === 'friends'
        ? <FriendsView user={user} campaign={null} onGoSettings={() => onPage('settings')} onToast={onToast}
          />
        : page === 'settings' ? <SettingsView user={user} campaign={null} onUserUpdated={onUserUpdated} onCampaignSelected={() => undefined} onCampaignDeleted={() => undefined} onToast={onToast}/> : null}</div>
    </main>
  </div>
}

function FriendsView({ user, campaign, onGoSettings, onToast }: {
  user: User; campaign: Campaign | null; onGoSettings: () => void; onToast: (message: string) => void;
}) {
  const [profile, setProfile] = useState<SocialProfile | null>(null)
  const [friends, setFriends] = useState<SocialProfile[]>([])
  const [incomingRequests, setIncomingRequests] = useState<SocialFriendRequest[]>([])
  const [outgoingRequests, setOutgoingRequests] = useState<SocialFriendRequest[]>([])
  const [incomingInvitations, setIncomingInvitations] = useState<SocialGameInvitation[]>([])
  const [outgoingInvitations, setOutgoingInvitations] = useState<SocialGameInvitation[]>([])
  const [profileById, setProfileById] = useState<Record<string, SocialProfile>>({})
  const [publicId, setPublicId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingAction, setPendingAction] = useState('')
  const [copied, setCopied] = useState(false)
  const [tunnel, setTunnel] = useState<TunnelStatus>({ status: 'stopped', publicUrl: null, error: null })
  const social = supabase as any

  async function loadSocial() {
    if (!user.authLinked) { setLoading(false); return }
    setError('')
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser()
      if (authError || !authData.user) throw new Error('Reconnecte ton compte en ligne depuis Réglages pour utiliser la fonction Amis.')
      const { data: myProfileData, error: profileError } = await social.rpc('sync_my_social_profile', {
        p_username: user.username, p_display_name: user.displayName,
      })
      if (profileError) throw profileError
      const myProfile = myProfileData as SocialProfile
      const uid = authData.user.id
      const [friendshipsResult, incomingResult, outgoingResult, receivedGameResult, sentGameResult] = await Promise.all([
        social.from('social_friendships').select('user_low,user_high,created_at').or(`user_low.eq.${uid},user_high.eq.${uid}`),
        social.from('social_friend_requests').select('id,sender_id,recipient_id,status,created_at').eq('recipient_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
        social.from('social_friend_requests').select('id,sender_id,recipient_id,status,created_at').eq('sender_id', uid).eq('status', 'pending').order('created_at', { ascending: false }),
        social.from('social_game_invitations').select('id,sender_id,recipient_id,game_id,campaign_name,host_url,status,created_at,expires_at').eq('recipient_id', uid).in('status', ['pending', 'accepted']).order('created_at', { ascending: false }),
        social.from('social_game_invitations').select('id,sender_id,recipient_id,game_id,campaign_name,host_url,status,created_at,expires_at').eq('sender_id', uid).order('created_at', { ascending: false }).limit(25),
      ])
      for (const result of [friendshipsResult, incomingResult, outgoingResult, receivedGameResult, sentGameResult]) if (result.error) throw result.error
      const nextFriendships = (friendshipsResult.data || []) as SocialFriendship[]
      const nextIncoming = (incomingResult.data || []) as SocialFriendRequest[]
      const nextOutgoing = (outgoingResult.data || []) as SocialFriendRequest[]
      const nextIncomingInvites = (receivedGameResult.data || []) as SocialGameInvitation[]
      const nextOutgoingInvites = (sentGameResult.data || []) as SocialGameInvitation[]
      const friendIds = nextFriendships.map((item) => item.user_low === uid ? item.user_high : item.user_low)
      const relatedIds = [...new Set([
        ...friendIds, ...nextIncoming.map((item) => item.sender_id), ...nextOutgoing.map((item) => item.recipient_id),
        ...nextIncomingInvites.map((item) => item.sender_id), ...nextOutgoingInvites.map((item) => item.recipient_id),
      ])]
      let relatedProfiles: SocialProfile[] = []
      if (relatedIds.length) {
        const { data, error: relatedError } = await social.from('social_profiles').select('user_id,public_id,username,display_name').in('user_id', relatedIds)
        if (relatedError) throw relatedError
        relatedProfiles = (data || []) as SocialProfile[]
      }
      const byId = Object.fromEntries(relatedProfiles.map((item) => [item.user_id, item])) as Record<string, SocialProfile>
      setProfile(myProfile); setProfileById(byId)
      setFriends(friendIds.map((id) => byId[id]).filter(Boolean))
      setIncomingRequests(nextIncoming); setOutgoingRequests(nextOutgoing)
      setIncomingInvitations(nextIncomingInvites); setOutgoingInvitations(nextOutgoingInvites)
      if (user.role === 'gm' && campaign?.status === 'active') {
        try { setTunnel(await api<TunnelStatus>('/api/tunnel')) }
        catch { setTunnel({ status: 'stopped', publicUrl: null, error: 'Vérifie l’hébergement dans Réglages.' }) }
      } else setTunnel({ status: 'stopped', publicUrl: null, error: null })
    } catch (cause) {
      const message = errorMessage(cause, 'Impossible de charger les amis.')
      const schemaMissing = ['PGRST202', 'PGRST205', '42P01'].includes(errorCode(cause)) || /social_profiles|social_friendships|social_friend_requests|social_game_invitations|sync_my_social_profile|schema cache|does not exist|could not find function/i.test(message)
      setError(schemaMissing
        ? 'Les tables Amis ne sont pas encore installées dans Supabase. Applique le script de migration dans le SQL Editor du projet avant de réessayer.'
        : message)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    let disposed = false
    const refresh = async () => { if (!disposed) await loadSocial() }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 30000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [user.authLinked, user.username, user.displayName, user.role, campaign?.id, campaign?.status])

  async function addFriend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const code = publicId.trim().toUpperCase()
      const { data: target, error: findError } = await social.rpc('find_social_profile', { p_public_id: code })
      if (findError) throw findError
      if (!target?.user_id) throw new Error('Aucun compte trouvé avec cet ID joueur.')
      const { error: requestError } = await social.rpc('send_social_friend_request', { p_recipient_id: target.user_id })
      if (requestError) throw requestError
      setPublicId('')
      await loadSocial()
      onToast(`Demande envoyée à ${target.display_name}.`)
    } catch (cause) { setError(errorMessage(cause, 'Impossible d’envoyer la demande.')) }
    finally { setBusy(false) }
  }

  async function respondFriendRequest(request: SocialFriendRequest, accept: boolean) {
    setPendingAction(request.id); setError('')
    try {
      const { error: responseError } = await social.rpc('respond_social_friend_request', { p_request_id: request.id, p_accept: accept })
      if (responseError) throw responseError
      await loadSocial()
      onToast(accept ? 'Ami ajouté.' : 'Demande refusée.')
    } catch (cause) { setError(errorMessage(cause, 'Impossible de répondre à cette demande.')) }
    finally { setPendingAction('') }
  }

  async function sendGameInvitation(friend: SocialProfile) {
    if (!campaign || user.role !== 'gm' || !campaign.isOwner) return
    setPendingAction(friend.user_id); setError('')
    try {
      const currentTunnel = tunnel.status === 'online' && tunnel.publicUrl ? tunnel : await api<TunnelStatus>('/api/tunnel')
      if (currentTunnel.status !== 'online' || !currentTunnel.publicUrl) throw new Error('Héberge d’abord la campagne en ligne dans Réglages.')
      const { error: inviteError } = await social.rpc('send_social_game_invitation', {
        p_recipient_id: friend.user_id, p_game_id: campaign.gameId, p_campaign_name: campaign.name, p_host_url: currentTunnel.publicUrl,
      })
      if (inviteError) throw inviteError
      await loadSocial()
      onToast(`Invitation envoyée à ${friend.display_name}.`)
    } catch (cause) { setError(errorMessage(cause, 'Impossible d’envoyer cette invitation.')) }
    finally { setPendingAction('') }
  }

  async function answerGameInvitation(invite: SocialGameInvitation, accept: boolean) {
    setPendingAction(invite.id); setError('')
    try {
      const { error: answerError } = await social.rpc('respond_social_game_invitation', { p_invitation_id: invite.id, p_accept: accept })
      if (answerError) throw answerError
      if (accept) {
        const destination = new URL(`${invite.host_url}/`)
        destination.searchParams.set('game', invite.game_id)
        destination.searchParams.set('invite', invite.id)
        window.location.assign(destination.toString())
        return
      }
      await loadSocial()
      onToast('Invitation refusée.')
    } catch (cause) { setError(errorMessage(cause, 'Impossible de répondre à cette invitation.')) }
    finally { setPendingAction('') }
  }

  async function copyPublicId() {
    if (!profile) return
    try { await navigator.clipboard.writeText(profile.public_id); setCopied(true); window.setTimeout(() => setCopied(false), 1800) }
    catch { setError('Le presse-papiers n’est pas accessible sur cet appareil.') }
  }

  const profileFor = (id: string) => profileById[id]
  const invitationExpired = (invite: SocialGameInvitation) => new Date(invite.expires_at).getTime() <= Date.now()
  const tunnelReady = Boolean(campaign && user.role === 'gm' && campaign.isOwner && campaign.status === 'active' && tunnel.status === 'online' && tunnel.publicUrl)

  return <>
    <div className="welcome-row"><div><div className="eyebrow">COMPAGNONS DE ROUTE</div><h1>Amis et <em>invitations</em></h1><p className="muted">Retrouve tes joueurs, MJ et prochaines parties depuis ton ID personnel.</p></div><button className="button-outline social-refresh" onClick={() => { setLoading(true); void loadSocial() }} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/>{loading ? 'Actualisation…' : 'Actualiser'}</button></div>
    {!user.authLinked ? <section className="panel social-link-required"><div className="social-section-icon"><Shield size={20}/></div><div><h2>Compte en ligne requis</h2><p>Lie ou crée un compte Supabase dans Réglages pour recevoir un ID joueur et synchroniser tes amis sur les différents PC.</p><button className="button-primary" onClick={onGoSettings}>Ouvrir les réglages <ArrowUpRight size={14}/></button></div></section> : <>
      {error && <div className="form-error social-error"><span>{error}</span>{error.includes('Tables Amis ne sont pas encore installées') && <a className="social-migration-link" href="https://raw.githubusercontent.com/Xinoce/Yuta-et-les-11/main/supabase/migrations/20261102000000_social_friends_invites.sql">Ouvrir le script SQL à appliquer</a>}</div>}
      {profile && <section className="panel social-id-panel"><div><div className="eyebrow">TON IDENTIFIANT DE COMPTE</div><h2>{profile.public_id}</h2><p>Partage cet ID pour que tes amis puissent t’ajouter. Ton adresse e-mail reste privée.</p></div><button className="button-outline" onClick={() => void copyPublicId()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copié' : 'Copier mon ID'}</button></section>}
      <div className="social-grid"><section className="panel social-add-panel"><div className="panel-heading"><div><div className="eyebrow">NOUVEAUX COMPAGNONS</div><h2>Ajouter un ami</h2></div><span className="subtle-icon"><Users size={17}/></span></div><p className="muted">Saisis l’ID joueur reçu. Une demande sera envoyée et l’autre personne pourra l’accepter.</p><form className="social-add-form" onSubmit={addFriend}><label>ID joueur<input value={publicId} onChange={(event) => setPublicId(event.target.value)} placeholder="pseudo#0427" minLength={7} maxLength={29} required/></label><button className="button-primary" disabled={busy || !publicId.trim()}><Send size={15}/>{busy ? 'Envoi…' : 'Envoyer la demande'}</button></form></section>
        <section className="panel social-inbox-panel"><div className="panel-heading"><div><div className="eyebrow">À TRAITER</div><h2>Demandes d’amitié</h2></div><span className="request-count">{incomingRequests.length} reçue{incomingRequests.length === 1 ? '' : 's'}</span></div><div className="social-list">{incomingRequests.length ? incomingRequests.map((request) => { const sender = profileFor(request.sender_id); return <article className="social-row" key={request.id}><div className="social-avatar">{sender?.display_name.slice(0,1).toUpperCase() || '?'}</div><div className="social-row-copy"><strong>{sender?.display_name || 'Joueur'}</strong><small>{sender?.public_id || 'Demande reçue'}</small></div><button className="button-outline" onClick={() => void respondFriendRequest(request, true)} disabled={pendingAction === request.id}><Check size={14}/> Accepter</button><button className="button-quiet danger-text" onClick={() => void respondFriendRequest(request, false)} disabled={pendingAction === request.id} aria-label="Refuser"><X size={15}/></button></article>}) : <div className="social-empty">Aucune demande en attente.</div>}</div></section>
      </div>

      {incomingInvitations.length > 0 && <section className="panel social-games-panel"><div className="panel-heading"><div><div className="eyebrow">ON T’ATTEND À LA TABLE</div><h2>Invitations de partie</h2></div><span className="request-count">{incomingInvitations.length}</span></div><div className="social-list">{incomingInvitations.map((invite) => { const inviter = profileFor(invite.sender_id); const expired = invitationExpired(invite); return <article className="social-game-invite" key={invite.id}><div className="social-section-icon"><Gamepad2 size={19}/></div><div className="social-row-copy"><strong>{invite.campaign_name}</strong><small>MJ {inviter?.display_name || 'ami'} · {inviter?.public_id || 'ID indisponible'} · {invite.game_id} · {expired ? 'Expirée' : invite.status === 'accepted' ? 'Acceptée' : 'Expire dans 7 jours'}</small></div><button className="button-primary" onClick={() => void answerGameInvitation(invite, true)} disabled={pendingAction === invite.id || expired}>Rejoindre <ArrowUpRight size={14}/></button>{invite.status === 'pending' && <button className="button-quiet danger-text" onClick={() => void answerGameInvitation(invite, false)} disabled={pendingAction === invite.id}>Refuser</button>}</article>})}</div></section>}

      <section className="panel social-friends-panel"><div className="panel-heading"><div><div className="eyebrow">VOTRE CERCLE</div><h2>Amis</h2></div><span className="request-count">{friends.length}</span></div><div className="social-list">{friends.length ? friends.map((friend) => { const hasPendingInvite = outgoingInvitations.some((invite) => invite.recipient_id === friend.user_id && invite.status === 'pending' && !invitationExpired(invite)); return <article className="social-row" key={friend.user_id}><div className="social-avatar">{friend.display_name.slice(0,1).toUpperCase()}</div><div className="social-row-copy"><strong>{friend.display_name}</strong><small>{friend.public_id}</small></div>{user.role === 'gm' && campaign?.isOwner && <button className="button-outline" onClick={() => void sendGameInvitation(friend)} disabled={!tunnelReady || hasPendingInvite || pendingAction === friend.user_id} title={!tunnelReady ? 'Démarre le lien en ligne dans Réglages.' : undefined}><Send size={14}/>{hasPendingInvite ? 'Invitation envoyée' : 'Inviter à la partie'}</button>}</article>}) : <div className="social-empty">Aucun ami pour le moment. Ajoute un joueur avec son ID ci-dessus.</div>}</div></section>

      {outgoingRequests.length > 0 && <section className="panel social-sent-panel"><div className="panel-heading"><div><div className="eyebrow">EN ATTENTE</div><h2>Demandes envoyées</h2></div><span className="request-count">{outgoingRequests.length}</span></div><div className="social-list">{outgoingRequests.map((request) => { const target = profileFor(request.recipient_id); return <div className="social-row" key={request.id}><div className="social-avatar">{target?.display_name.slice(0,1).toUpperCase() || '?'}</div><div className="social-row-copy"><strong>{target?.display_name || 'Joueur'}</strong><small>{target?.public_id || 'Demande en attente'}</small></div><span className="social-pending-label">En attente</span></div>})}</div></section>}

      {outgoingInvitations.length > 0 && <section className="panel social-sent-panel"><div className="panel-heading"><div><div className="eyebrow">INVITATIONS ENVOYÉES</div><h2>Suivi des invitations</h2></div><span className="request-count">{outgoingInvitations.length}</span></div><div className="social-list">{outgoingInvitations.slice(0, 8).map((invite) => { const recipient = profileFor(invite.recipient_id); return <div className="social-row" key={invite.id}><div className="social-avatar"><Gamepad2 size={15}/></div><div className="social-row-copy"><strong>{invite.campaign_name} · {recipient?.display_name || 'Ami'}</strong><small>{recipient?.public_id || 'ID indisponible'} · {invite.game_id} · {invite.status === 'accepted' ? 'Acceptée' : invite.status === 'declined' ? 'Refusée' : invitationExpired(invite) ? 'Expirée' : 'En attente'}</small></div></div>})}</div></section>}

      {user.role === 'gm' && campaign?.isOwner && <div className={`social-host-status ${tunnelReady ? 'online' : ''}`}><Globe2 size={15}/><span>{tunnelReady ? 'Ta partie est en ligne : tu peux envoyer des invitations à tes amis.' : campaign.status !== 'active' ? 'Réactive la campagne avant d’envoyer des invitations.' : 'Pour inviter un ami, démarre d’abord l’hébergement en ligne dans Réglages.'}</span><button className="text-link" onClick={onGoSettings}>Réglages</button></div>}
    </>}
  </>
}
