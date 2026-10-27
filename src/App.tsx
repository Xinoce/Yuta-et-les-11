import { useCallback, useEffect, useMemo, useState } from 'react'
import { io, Socket } from 'socket.io-client'
import { supabase } from './supabase'
import {
  Activity, ArrowDownRight, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Copy,
  ClipboardList, Coins, Compass, Dices, DoorOpen, Eye, EyeOff, Feather, Gamepad2, Globe2, Heart, Image as ImageIcon, KeyRound, LogIn, LogOut,
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
    setCampaignHome(data.user.role === 'gm' && (!data.campaign || data.campaign.status !== 'active'))
    setView(data.user.mustChangePassword ? 'settings' : data.user.role === 'player' ? 'selectCharacter' : data.campaign ? 'game' : 'settings')
  }
  const onCampaignSelected = (campaign: Campaign) => {
    setCampaignHome(false)
    setSession((current) => current ? { ...current, campaign } : current)
    setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setLoadingData(true); setCreatingCharacter(false)
    setView(session?.user.role === 'player' ? 'selectCharacter' : 'game')
  }
  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }); await supabase.auth.signOut(); socket?.disconnect(); setSocket(null); setSession(null)
    setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setGameImages([]); setCampaignHome(false); setLoadingData(true)
  }

  if (initializing) return <div className="loading-screen"><div className="sigil"><Sparkles /></div><p>La table s’éveille…</p></div>
  if (!session) return <WelcomeFlow onAuthenticated={signIn} />
  if (session.user.mustChangePassword) return <SettingsView user={session.user} campaign={session.campaign} forced onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setCampaignHome(user.role === 'gm' && (!campaign || campaign.status !== 'active')); setView(user.role === 'gm' && !campaign ? 'settings' : user.role === 'player' ? 'selectCharacter' : 'game') }} onCampaignSelected={onCampaignSelected} onCampaignDeleted={() => undefined} onToast={setToast} />
  if (!session.campaign || campaignHome) return session.user.role === 'gm'
    ? <CampaignCreateScreen user={session.user} onSelected={onCampaignSelected} onCreated={(campaign, joinPassword) => { setCampaignHome(false); setSession((current) => current ? { ...current, campaign } : current); setLastJoinPassword(joinPassword); setView('game') }} />
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
      <nav className="side-nav">{nav.map(({ id, label, icon: Icon, badge }) => <button key={id} className={view === id ? 'nav-item active' : 'nav-item'} onClick={() => setView(id)}><Icon size={17} /><span>{label}</span>{badge ? <b className="nav-badge">{badge}</b> : null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection"><span className={socket?.connected ? 'status-dot' : 'status-dot offline'} />{socket?.connected ? 'Synchronisé en direct' : 'Reconnexion…'}</div><div className="profile-row"><div className="avatar">{session.user.displayName.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{session.user.displayName}</strong><span>{isGM ? 'Maître du Jeu' : ownCharacter?.name || 'Joueur'}</span></div><button className="icon-button" aria-label="Réglages du compte" title="Réglages du compte" onClick={() => setView('settings')}><Settings size={15} /></button><button className="icon-button" aria-label="Se déconnecter" title="Se déconnecter" onClick={() => void signOut()}><LogOut size={15} /></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumb">CAMPAGNE <span>/</span> <strong>{session.campaign.name}</strong></div><div className="top-actions"><span className="online-count"><i /> {members.filter((m) => m.online).length} en ligne</span><button className="small-avatar">{session.user.displayName.slice(0, 1).toUpperCase()}</button></div></header>
      {session.campaign.status !== 'active' && <div className={`campaign-state-banner ${session.campaign.status}`}>{session.campaign.status === 'paused' ? 'Campagne en pause : les lancers et les tests sont suspendus. Le MJ peut la reprendre dans Réglages.' : 'Campagne arrêtée : les lancers et les inscriptions sont suspendus. Le MJ peut la réactiver dans Réglages.'}</div>}
      <div className="page-content">
        {loadingData && <div className="loading-card"><div className="sigil"><Sparkles size={17}/></div><span>La partie se prépare…</span></div>}
        {!loadingData && view === 'selectCharacter' && characters.length === 0 && <CharacterView user={session.user} characters={characters} members={members} forceNew onSaved={(character) => { setCharacters([character]); setActiveCharacter(character); setCreatingCharacter(false); setView('game') }} onToast={setToast} />}
        {!loadingData && view === 'selectCharacter' && characters.length > 0 && <CharacterPickerView characters={characters} activeCharacter={activeCharacter} onSelect={async (character) => { try { const chosen = await api<Character>('/api/active-character', { method: 'POST', body: JSON.stringify({ characterId: character.id }) }); setActiveCharacter(chosen); setView('game') } catch (error) { setToast(error instanceof Error ? error.message : 'Choix impossible.') } }} onCreate={() => { setCreatingCharacter(true); setView('character') }} />}
        {!loadingData && view === 'game' && <GameView isGM={isGM} campaignStatus={session.campaign.status} character={ownCharacter} images={gameImages} rolls={rolls.slice(0, 6)} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal de jeu.')).catch((e) => setToast(e.message))} onUpload={async (payload) => { const image = await api<GameImage>('/api/game-images', { method: 'POST', body: JSON.stringify(payload) }); setGameImages((current) => [image, ...current]); setToast('Image ajoutée à la galerie de campagne.') }} onShow={async (image, isShown) => { const updated = await api<GameImage>(`/api/game-images/${image.id}`, { method: 'PATCH', body: JSON.stringify({ isShown }) }); setGameImages((current) => current.map((item) => item.id === updated.id ? updated : { ...item, isShown: isShown ? false : item.isShown })); setToast(isShown ? 'Image affichée aux joueurs.' : 'Image retirée de l’écran des joueurs.') }} onDelete={async (image) => { await api(`/api/game-images/${image.id}`, { method: 'DELETE' }); setGameImages((current) => current.filter((item) => item.id !== image.id)); setToast('Image supprimée de la galerie.') }} />}
        {!loadingData && view === 'table' && <TableView session={{ ...session, campaign: session.campaign! }} isGM={isGM} ownCharacter={ownCharacter} members={members} rolls={rolls} requests={requests} onRoll={(payload) => api<Roll>('/api/rolls', { method: 'POST', body: JSON.stringify(payload) }).then(() => setToast('Lancer ajouté au journal partagé.')).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onGo={setView} />}
        {!loadingData && view === 'character' && <CharacterView user={session.user} characters={characters} members={members} activeCharacter={activeCharacter} forceNew={creatingCharacter} onCreateNew={() => setCreatingCharacter(true)} onCancelCreate={() => setCreatingCharacter(false)} onActiveCharacter={setActiveCharacter} onSaved={(character) => { setCharacters((current) => [character, ...current.filter((v) => v.id !== character.id)]); if (session.user.role === 'player') { setActiveCharacter(character); setCreatingCharacter(false); setView('game') } else setCreatingCharacter(false) }} onToast={setToast} />}
        {view === 'requests' && <RequestsView isGM={isGM} campaignStatus={session.campaign.status} userId={session.user.id} members={members} characters={characters} requests={requests} onCreate={(payload) => api<RollRequest>('/api/requests', { method: 'POST', body: JSON.stringify(payload) }).then((request) => { setRequests((current) => [request, ...current.filter((v) => v.id !== request.id)]); setToast('La demande de test a été envoyée.') }).catch((e) => setToast(e.message))} onResolve={(id) => api(`/api/requests/${id}/resolve`, { method: 'POST' }).then(() => setToast('Test résolu et partagé avec la table.')).catch((e) => setToast(e.message))} onCancel={(id) => api<RollRequest>(`/api/requests/${id}/cancel`, { method: 'POST' }).then((request) => setRequests((current) => current.map((v) => v.id === id ? request : v))).catch((e) => setToast(e.message))} />}
        {!loadingData && view === 'players' && <PlayersView members={members} campaign={session.campaign} />}
        {!loadingData && view === 'settings' && <SettingsView user={session.user} campaign={session.campaign} lastJoinPassword={lastJoinPassword} onJoinPasswordChanged={setLastJoinPassword} onUserUpdated={(user, campaign) => { setSession({ user, campaign }); setToast('Profil enregistré.'); if (!campaign && user.role === 'gm') setView('table') }} onCampaignSelected={onCampaignSelected} onCampaignDeleted={(deletedId, nextCampaign) => { if (session.campaign?.id === deletedId) { setSession({ user: session.user, campaign: nextCampaign }); setCampaignHome(!nextCampaign || nextCampaign.status !== 'active'); setMembers([]); setCharacters([]); setActiveCharacter(null); setRolls([]); setRequests([]); setGameImages([]); setLoadingData(Boolean(nextCampaign)) } }} onToast={setToast} />}
      </div>
    </main>
    {toast && <div className="toast"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="Fermer"><X size={15} /></button></div>}
  </div>
}

function WelcomeFlow({ onAuthenticated, initialRole = null }: { onAuthenticated: (data: SessionData) => void; initialRole?: 'gm' | 'player' | null }) {
  const inviteGameId = new URLSearchParams(window.location.search).get('game')?.trim() || ''
  const [role, setRole] = useState<'gm' | 'player' | null>(initialRole || (inviteGameId ? 'player' : null))
  const [step, setStep] = useState<'role' | 'lobbies' | 'auth'>(initialRole || inviteGameId ? 'lobbies' : 'role')
  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [selectedLobby, setSelectedLobby] = useState<Lobby | null>(null)
  const [lobbySearch, setLobbySearch] = useState('')
  const [register, setRegister] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function refreshLobbies() {
    setBusy(true); setError('')
    try {
      const found = await api<Lobby[]>(`/api/lobbies${inviteGameId ? `?gameId=${encodeURIComponent(inviteGameId)}` : ''}`)
      setLobbies(found)
      if (inviteGameId && found[0]) { setRole('player'); setSelectedLobby(found[0]); setStep('auth') }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Impossible de chercher les parties.') }
    finally { setBusy(false) }
  }
  useEffect(() => { if (inviteGameId) void refreshLobbies() }, [])
  const visibleLobbies = lobbies.filter((lobby) => `${lobby.gameId} ${lobby.name} ${lobby.hostName}`.toLowerCase().includes(lobbySearch.toLowerCase().trim()))
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true)
    const form = new FormData(event.currentTarget)
    const values = Object.fromEntries(form.entries())
    try {
      if (role === 'player' && !selectedLobby) throw new Error('Choisissez une partie avant de continuer.')
      let data: SessionData
      if (register) {
        const email = String(values.email || '').trim().toLowerCase()
        const password = String(values.password || '')
        const { data: signedUp, error: signUpError } = await supabase.auth.signUp({
          email, password,
          options: { data: { username: String(values.username || ''), displayName: String(values.displayName || '') } },
        })
        if (signUpError) throw new Error(signUpError.message)
        if (!signedUp.session) {
          setRegister(false)
          throw new Error('Compte créé. Confirme ton adresse e-mail, puis reviens ici et connecte-toi avec cette adresse. Le profil joueur sera créé à la première connexion.')
        }
        data = await api<SessionData>('/api/auth/register', { method: 'POST', body: JSON.stringify({
          accessToken: signedUp.session.access_token, email, username: values.username, displayName: values.displayName,
          joinPassword: values.joinPassword, campaignId: selectedLobby?.id,
        }) })
      } else if (String(values.identifier || '').includes('@')) {
        const email = String(values.identifier).trim().toLowerCase()
        const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password: String(values.password || '') })
        if (signInError || !signedIn.session) throw new Error(signInError?.message || 'Connexion Supabase impossible.')
        try { data = await api<SessionData>('/api/auth/login', { method: 'POST', body: JSON.stringify({ accessToken: signedIn.session.access_token, role }) }) }
        catch (error) { await supabase.auth.signOut(); throw error }
      } else {
        // Keep legacy local sign-in available so current MJ/player profiles can link Supabase from Settings.
        data = await api<SessionData>('/api/auth/login', { method: 'POST', body: JSON.stringify(values) })
      }
      if (data.user.role !== role) {
        await api('/api/auth/logout', { method: 'POST' })
        await supabase.auth.signOut()
        throw new Error(role === 'gm' ? 'Ce compte n’a pas le rôle Maître du Jeu.' : 'Ce compte est un compte MJ. Choisissez le parcours MJ.')
      }
      if (role === 'player' && !register && selectedLobby) {
        await api(`/api/campaigns/${selectedLobby.id}/join`, { method: 'POST', body: JSON.stringify({ joinPassword: values.joinPassword }) })
        onAuthenticated(await api<SessionData>('/api/me'))
      } else onAuthenticated(data)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Connexion impossible.') }
    finally { setBusy(false) }
  }
  return <div className="welcome-screen"><div className="welcome-backdrop" aria-hidden="true"><div className="arcane-sigil"/><div className="arcane-sigil arcane-sigil-small"/></div><div className="welcome-top"><div className="brand-mark"><Sparkles size={19}/></div><span>YUTA ET LES 11</span><i>·</i><small>UNE CAMPAGNE À ÉCRIRE</small></div><div className="welcome-body"><div className="welcome-copy"><span className="eyebrow">MAGIE · DESTIN · MYSTÈRE</span><h1>Un monde à part,<br/>des destins <em>à forger.</em></h1><p>Le hasard trace la voie.<br/>Vos choix en font une légende.</p><div className="welcome-stars">✦ <span>LA TABLE ATTEND SON GROUPE</span> ✦</div></div>
    {step === 'role' && <section className="role-card"><div className="eyebrow">COMMENT REJOINS-TU L’AVENTURE ?</div><h2>Choisis ta place</h2><button className="role-choice gm" onClick={() => { setRole('gm'); setStep('auth'); setRegister(false) }}><span className="role-icon"><ScrollText size={20}/></span><span><strong>Je suis le Maître du Jeu</strong><small>Créer la campagne et guider le groupe</small></span><ChevronRight size={17}/></button><button className="role-choice player" onClick={() => { setRole('player'); setStep('lobbies'); setRegister(false); void refreshLobbies() }}><span className="role-icon"><Compass size={20}/></span><span><strong>Je suis un joueur</strong><small>Choisir un héros et trouver une partie</small></span><ChevronRight size={17}/></button><div className="role-footer"><Shield size={14}/> Comptes et parties gardés sur le PC du MJ</div></section>}
    {step === 'lobbies' && <section className="role-card lobby-card"><button className="back-link" onClick={() => { setStep('role'); setError('') }}><ArrowDownRight size={14}/> Changer de rôle</button><div className="eyebrow">PARCOURS JOUEUR</div><h2>Trouve ta partie</h2><p className="lobby-intro">Ouvre le lien envoyé par le MJ pour accéder à sa partie. Son ID sert ensuite à la retrouver dans cette liste.</p><button className="button-outline refresh-lobbies" onClick={() => void refreshLobbies()} disabled={busy}><RefreshCw size={15} className={busy ? 'spin' : ''}/>{busy ? 'Recherche…' : 'Actualiser les parties'}</button><label className="lobby-search-label">ID de partie<input value={lobbySearch} onChange={(e) => setLobbySearch(e.target.value)} placeholder="Ex. Y11-4F2A…" /></label>{error && <div className="form-error">{error}</div>}<div className="lobby-list">{visibleLobbies.length ? visibleLobbies.map((lobby) => <button className="lobby-row" key={lobby.id} onClick={() => { setSelectedLobby(lobby); setStep('auth'); setError('') }}><span className="lobby-glyph"><Gamepad2 size={17}/></span><span><strong>{lobby.name}</strong><small>{lobby.gameId} · MJ {lobby.hostName} · {lobby.playerCount} participant{lobby.playerCount === 1 ? '' : 's'}</small></span><ChevronRight size={16}/></button>) : <div className="lobby-empty"><Compass size={20}/><strong>Aucune partie repérée</strong><span>{inviteGameId ? 'Lien ou ID de partie invalide ou session indisponible.' : 'Depuis le lien transmis par le MJ, saisis son ID si nécessaire.'}</span></div>}</div></section>}
    {step === 'auth' && <section className="role-card auth-card"><button className="back-link" onClick={() => { setStep(role === 'player' ? 'lobbies' : 'role'); setError('') }}><ArrowDownRight size={14}/> Retour</button><div className="eyebrow">{role === 'gm' ? 'ESPACE MJ' : selectedLobby?.name.toUpperCase()}</div><h2>{register ? 'Créer ton compte' : 'Content de te revoir'}</h2><p className="lobby-intro">{role === 'gm' ? 'Connecte-toi pour préparer ta campagne.' : `Rejoins la partie de ${selectedLobby?.hostName || 'ton groupe'}.`}</p>{role === 'player' && selectedLobby && <div className="selected-game-id"><span>ID DE PARTIE</span><strong>{selectedLobby.gameId}</strong></div>}<form onSubmit={submit} className="auth-form">
      {register && <><label>Pseudo de connexion<input name="username" minLength={2} maxLength={24} placeholder="Ex. Mira" required autoComplete="username"/></label><label>Pseudo affiché<input name="displayName" minLength={2} maxLength={40} placeholder="Comment t’appelle-t-on ?" required autoComplete="nickname"/></label><label>Adresse e-mail<input name="email" type="email" placeholder="toi@exemple.fr" required autoComplete="email"/></label></>}
      {!register && <label>Adresse e-mail ou ancien pseudo<input name="identifier" placeholder={role === 'gm' ? 'Yuta ou toi@exemple.fr' : 'toi@exemple.fr'} required autoComplete="username"/></label>}
       {role === 'player' && <label>Mot de passe de la partie<input name="joinPassword" type="password" minLength={8} maxLength={200} placeholder="Mot de passe transmis par le MJ" required autoComplete="off"/></label>}
      <label>Mot de passe<input name="password" type="password" minLength={register ? 10 : 1} placeholder={register ? '10 caractères minimum' : 'Mot de passe'} required autoComplete={register ? 'new-password' : 'current-password'}/></label>
      {role === 'gm' && !register && <div className="admin-hint"><KeyRound size={14}/><span>Première connexion MJ : <strong>Yuta / admin123</strong>. Change ton mot de passe, crée une campagne, puis lie ton compte Supabase dans Réglages.</span></div>}
      {error && <div className="form-error">{error}</div>}<button className="button-primary auth-submit" disabled={busy}>{busy ? 'Connexion…' : register ? 'Rejoindre cette partie' : 'Continuer'} <ArrowUpRight size={16}/></button></form>
      {role === 'player' && <button className="text-link" onClick={() => { setRegister(!register); setError('') }}>{register ? 'J’ai déjà un compte' : 'Créer un compte joueur'}</button>}
      <div className="role-footer"><Shield size={14}/> {role === 'gm' ? 'Les réglages privés restent visibles uniquement par le MJ.' : 'Après connexion, tu pourras créer ou choisir ton personnage.'}</div></section>}
  </div><div className="welcome-bottom"><span>✦</span> DES HÉROS ORDINAIRES, DES AVENTURES EXTRAORDINAIRES <span>✦</span></div></div>
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
      const updated = await api<Campaign>('/api/campaign', { method: 'PATCH', body: JSON.stringify({ name: campaignName, isOpen, joinPassword, status: campaign?.status }) })
      onUserUpdated(user, updated)
      setCampaignName(updated.name); setIsOpen(updated.isOpen)
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
      setCampaignName(updated.name); setIsOpen(updated.isOpen)
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
    {!forced && <section className="panel settings-panel account-link-panel"><div className="panel-heading"><div><div className="eyebrow">COMPTE EN LIGNE</div><h2>Connexion Supabase</h2></div><span className="subtle-icon"><Shield size={17}/></span></div>{user.authLinked ? <><div className="account-linked"><Check size={16}/><span><strong>Compte lié</strong><small>{user.email}</small></span></div><p className="muted">Ton adresse e-mail et ton mot de passe sont gérés par Supabase. Les campagnes, personnages et images restent sur le PC du MJ.</p></> : <><p className="muted">Lie ton compte pour te connecter avec une adresse e-mail sur tous les appareils. Le profil de jeu local sera conservé.</p><div className="account-mode"><button type="button" className={supabaseMode === 'existing' ? 'active' : ''} onClick={() => { setSupabaseMode('existing'); setSupabaseError(''); setSupabaseInfo('') }}>J’ai déjà un compte</button><button type="button" className={supabaseMode === 'create' ? 'active' : ''} onClick={() => { setSupabaseMode('create'); setSupabaseError(''); setSupabaseInfo('') }}>Créer un compte</button></div><form className="settings-form" onSubmit={linkSupabase}><label>Adresse e-mail<input type="email" value={supabaseEmail} onChange={(e) => setSupabaseEmail(e.target.value)} autoComplete="email" required/></label><label>Mot de passe Supabase<input type="password" value={supabasePassword} onChange={(e) => setSupabasePassword(e.target.value)} minLength={supabaseMode === 'create' ? 10 : 1} autoComplete={supabaseMode === 'create' ? 'new-password' : 'current-password'} required/></label>{supabaseError && <div className="form-error">{supabaseError}</div>}{supabaseInfo && <div className="account-link-info">{supabaseInfo}</div>}<button className="button-primary" disabled={supabaseBusy}><Shield size={15}/>{supabaseBusy ? 'Liaison…' : supabaseMode === 'create' ? 'Créer et lier le compte' : 'Lier le compte'}</button></form></>}</section>}
    {!forced && campaign && user.role === 'gm' && <>
      <section className="panel settings-panel"><div className="panel-heading"><div><div className="eyebrow">ESPACE MJ</div><h2>Campagne et session</h2></div><span className="subtle-icon"><ScrollText size={17}/></span></div><form className="settings-form" onSubmit={saveCampaign}><label>Nom de la campagne<input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} maxLength={80} required/></label><label className="session-toggle"><input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)}/><span><strong>Partie visible aux joueurs</strong><small>{isOpen ? 'Visible dans la liste depuis le lien du MJ.' : 'Masquée de la liste ; le lien direct reste valable.'}</small></span></label><div className="session-code"><span>ID DE PARTIE</span><strong>{campaign.gameId}</strong></div><label>Nouveau mot de passe de partie<input type="password" value={joinPassword} onChange={(e) => setJoinPassword(e.target.value)} minLength={joinPassword ? 8 : undefined} maxLength={200} placeholder={campaign.joinPasswordSet ? 'Laisser vide pour conserver' : '8 caractères minimum'} autoComplete="new-password"/></label>{campaign.legacyJoinPassword && <div className="legacy-password-note">Ancienne partie : son ancien code d’invitation fait office de mot de passe. Change-le ici pour le remplacer.</div>}{error && <div className="form-error">{error}</div>}<button className="button-primary" disabled={busy}><Check size={15}/>Enregistrer les réglages<ArrowUpRight size={15}/></button></form></section>
      <section className="panel settings-panel online-panel"><div className="panel-heading"><div><div className="eyebrow">ACCÈS À DISTANCE</div><h2>Héberger en ligne</h2></div><span className="subtle-icon"><Globe2 size={17}/></span></div><p className="online-description">Ouvre un lien sécurisé vers ton PC MJ. Les joueurs n’ont pas besoin de connaître ton adresse IP ni d’installer Hamachi.</p><div className={`tunnel-status ${tunnel.status}`}><i/>{tunnel.status === 'online' ? 'Partie joignable en ligne' : tunnel.status === 'starting' ? 'Création du lien en cours…' : tunnel.status === 'stopping' ? 'Fermeture du lien…' : tunnel.status === 'error' ? 'Le lien en ligne est indisponible' : 'Aucun lien en ligne actif'}</div>{tunnel.error && <div className="tunnel-error">{tunnel.error}</div>}{gameUrl && <><div className="online-url"><span>{gameUrl}</span><button className="button-outline" onClick={() => void copyText(gameUrl, 'Lien de partie')}><Copy size={14}/>Copier le lien</button></div><div className="online-password"><div><span>MOT DE PASSE DE PARTIE</span><strong>{lastJoinPassword || (campaign.legacyJoinPassword ?? 'Déjà défini — saisis-en un nouveau pour le modifier')}</strong></div>{lastJoinPassword && <button className="text-link" onClick={() => void copyText(lastJoinPassword, 'Mot de passe')}>Copier</button>}</div></>}{!gameUrl && <p className="online-note">Le lien est temporaire et change à chaque ouverture. Partage aussi le mot de passe de la partie, séparément.</p>}<button className={tunnel.status === 'online' || tunnel.status === 'starting' ? 'button-outline tunnel-button' : 'button-primary tunnel-button'} onClick={() => void changeTunnel()} disabled={tunnelBusy || tunnel.status === 'stopping'}><Globe2 size={15}/>{tunnelBusy ? 'Patiente…' : tunnel.status === 'online' || tunnel.status === 'starting' ? 'Fermer le lien en ligne' : 'Créer un lien en ligne'}</button><div className="tunnel-footnote"><Shield size={13}/> Le trafic passe par Cloudflare Tunnel. Le lien est public : seul le mot de passe autorise à rejoindre.</div></section>
    </>}{!forced && <section className="panel settings-panel campaign-manager-panel"><div className="panel-heading"><div><div className="eyebrow">VOS AVENTURES</div><h2>Campagnes</h2></div><span className="subtle-icon"><Compass size={17}/></span></div><div className="campaign-manager-list">{campaigns.map((item) => { const current = item.id === campaign?.id; const label = item.status === 'active' ? 'En cours' : item.status === 'paused' ? 'En pause' : 'Arrêtée'; return <article className={`campaign-manager-row ${item.status}`} key={item.id}><div className="campaign-manager-info"><strong>{item.name}</strong><span className={`campaign-state ${item.status}`}>{label}</span><small>{item.gameId}</small></div>{current ? <span className="campaign-current">Campagne ouverte</span> : <div className="campaign-actions"><button type="button" className="button-outline" onClick={() => void selectCampaign(item.id)} disabled={campaignBusy}>Ouvrir</button>{item.isOwner && <button type="button" className="button-quiet danger-text" onClick={() => void deleteCampaign(item)} disabled={campaignBusy} title="Supprimer cette campagne"><Trash2 size={14}/> Supprimer</button>}</div>}{current && item.isOwner && <div className="campaign-controls">{item.status === 'active' && <button type="button" className="button-outline" onClick={() => void changeCampaignStatus('paused')} disabled={campaignBusy}>Mettre en pause</button>}{item.status === 'paused' && <button type="button" className="button-primary" onClick={() => void changeCampaignStatus('active')} disabled={campaignBusy}>Reprendre</button>}{item.status !== 'stopped' && <button type="button" className="button-quiet danger-text" onClick={() => void changeCampaignStatus('stopped')} disabled={campaignBusy}>Arrêter</button>}{item.status === 'stopped' && <button type="button" className="button-primary" onClick={() => void changeCampaignStatus('active')} disabled={campaignBusy}>Réactiver</button>}<button type="button" className="button-quiet danger-text" onClick={() => void deleteCampaign(item)} disabled={campaignBusy} title="Supprimer cette campagne"><Trash2 size={14}/> Supprimer</button></div>}</article>})}{campaigns.length === 0 && <p className="muted campaign-empty">Aucune campagne trouvée.</p>}</div>{user.role === 'gm' && <form className="campaign-create-form" onSubmit={createCampaign}><div className="eyebrow">NOUVELLE AVENTURE</div><label>Nom de la campagne<input value={newCampaignName} onChange={(event) => setNewCampaignName(event.target.value)} minLength={2} maxLength={80} required placeholder="Ex. Les routes du Nord"/></label><label>Mot de passe de la partie<input type="password" value={newCampaignPassword} onChange={(event) => setNewCampaignPassword(event.target.value)} minLength={8} maxLength={200} required placeholder="8 caractères minimum" autoComplete="new-password"/></label>{campaignError && <div className="form-error">{campaignError}</div>}<button className="button-primary" disabled={campaignBusy}><Plus size={15}/>{campaignBusy ? 'Patiente…' : 'Créer une campagne'}<ArrowUpRight size={15}/></button></form>}</section>}</div></>
}

function GameView({ isGM, campaignStatus, character, images, rolls, onRoll, onUpload, onShow, onDelete }: {
  isGM: boolean; campaignStatus: Campaign['status']; character: Character | null; images: GameImage[]; rolls: Roll[];
  onRoll: (payload: object) => void;
  onUpload: (payload: { name: string; contentType: string; data: string }) => Promise<void>;
  onShow: (image: GameImage, isShown: boolean) => Promise<void>;
  onDelete: (image: GameImage) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const shown = images.find((image) => image.isShown)
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { setError('Choisis une image JPG, PNG, GIF ou WebP.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Une image doit faire 10 Mo maximum.'); return }
    setUploading(true); setError('')
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] || '') : reject(new Error('Lecture de l’image impossible.'))
        reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
        reader.readAsDataURL(file)
      })
      await onUpload({ name: file.name, contentType: file.type, data: encoded })
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
  return <>
    <div className="welcome-row game-welcome"><div><div className="eyebrow">ESPACE DE JEU EN DIRECT</div><h1>La scène <em>présente.</em></h1><p className="muted">Les images du MJ, vos lancers et les derniers résultats réunis ici.</p></div><span className={`session-tag ${campaignStatus}`}><i className={`status-dot ${campaignStatus === 'active' ? '' : 'offline'}`}/>{campaignStatus === 'active' ? 'SESSION ACTIVE' : campaignStatus === 'paused' ? 'EN PAUSE' : 'ARRÊTÉE'}</span></div>
    <div className="game-layout">
      <section className="panel game-stage-panel">
        <div className="panel-heading"><div><div className="eyebrow">CE QUE LA TABLE VOIT</div><h2>Écran de jeu</h2></div><span className="subtle-icon"><ImageIcon size={18}/></span></div>
        {shown ? <figure className="game-projection"><img src={shown.url} alt={shown.name}/><figcaption>{shown.name}</figcaption></figure> : <div className="game-projection-empty"><div className="game-projection-icon"><ImageIcon size={24}/></div><strong>{isGM ? 'Choisis une image à partager' : 'Le MJ prépare la scène'}</strong><span>{isGM ? 'Les joueurs ne verront que l’image affichée.' : 'La carte ou l’illustration choisie par le MJ apparaîtra ici.'}</span></div>}
        {isGM && <div className="game-image-tools"><label className={`button-primary game-upload-button ${uploading ? 'disabled' : ''}`}><Upload size={15}/>{uploading ? 'Ajout…' : 'Ajouter une image'}<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => void upload(event)} disabled={uploading}/></label><small>JPG, PNG, GIF ou WebP · 10 Mo max.</small></div>}
        {error && <div className="form-error game-error">{error}</div>}
        {isGM && <div className="game-image-library">{images.map((image) => <article className={`game-image-card ${image.isShown ? 'shown' : ''}`} key={image.id}><img src={image.url} alt=""/><div className="game-image-copy"><strong title={image.name}>{image.name}</strong><small>{Math.max(1, Math.round(image.byteSize / 1024))} Ko {image.isShown ? '· Visible' : ''}</small></div><button className="icon-button" type="button" onClick={() => void show(image, !image.isShown)} title={image.isShown ? 'Masquer aux joueurs' : 'Montrer aux joueurs'} aria-label={image.isShown ? 'Masquer aux joueurs' : 'Montrer aux joueurs'}>{image.isShown ? <EyeOff size={15}/> : <Eye size={15}/>}</button><button className="icon-button danger-text" type="button" onClick={() => void remove(image)} title="Supprimer l’image" aria-label="Supprimer l’image"><Trash2 size={15}/></button></article>)}{images.length === 0 && <p className="game-library-empty">La galerie est vide. Ajoute une carte, un portrait ou une illustration pour la partager.</p>}</div>}
      </section>
      <aside className="game-side-column">
        <section className="panel game-dice-panel"><div className="panel-heading"><div><div className="eyebrow">LE HASARD TRANCHE</div><h2>Lancer les dés</h2></div><span className="subtle-icon"><Dices size={18}/></span></div>{campaignStatus === 'active' ? <><DiceControls character={character} onRoll={onRoll}/><CustomDice onRoll={onRoll}/></> : <div className="campaign-inactive-note"><Shield size={17}/><span>Les lancers reprendront quand le MJ relancera la campagne.</span></div>}</section>
        <section className="panel game-rolls-panel"><div className="game-rolls-heading"><div><div className="eyebrow">RÉSUMÉ DISCRET</div><h2>Derniers lancers</h2></div><span className="live-pill"><i/> LIVE</span></div><div className="game-roll-list">{rolls.length ? rolls.map((roll) => <RollItem key={roll.id} roll={roll}/>) : <p className="game-library-empty">Les prochains résultats apparaîtront ici.</p>}</div></section>
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
    <div className="table-grid"><section className="panel dice-panel"><div className="panel-heading"><div><div className="eyebrow">LE HASARD TRANCHE</div><h2>À vous de jouer</h2></div><span className="subtle-icon"><Dices size={18}/></span></div><p className="muted panel-intro">Lancez librement, ou laissez le Maître du Jeu définir votre prochain défi.</p>{session.campaign.status === 'active' ? <><DiceControls character={ownCharacter} onRoll={onRoll}/><div className="divider-label"><span/> OU LANCEZ À VOTRE FAÇON <span/></div><CustomDice onRoll={onRoll}/></> : <div className="campaign-inactive-note"><Shield size={18}/><span>{session.campaign.status === 'paused' ? 'Les lancers reprendront quand le MJ relancera la campagne.' : 'Cette campagne est arrêtée. Le MJ peut la réactiver depuis Réglages.'}</span></div>}
      <div className="quick-links"><button onClick={() => onGo('character')}><BookOpen size={15}/> Fiche du personnage <ArrowUpRight size={14}/></button><button onClick={() => onGo('requests')}><ClipboardList size={15}/> {isGM ? 'Gérer les requêtes' : 'Mes tests demandés'} <ArrowUpRight size={14}/></button></div>
    </section><RollHistory rolls={rolls.slice(0, 9)}/></div>
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

function RollHistory({ rolls }: { rolls: Roll[] }) {
  return <section className="panel history-panel"><div className="panel-heading"><div><div className="eyebrow">JOURNAL DE LA CAMPAGNE</div><h2>Derniers lancers</h2></div><span className="live-pill"><i/> EN DIRECT</span></div><div className="roll-list">{rolls.length ? rolls.map((roll) => <RollItem key={roll.id} roll={roll}/>) : <div className="empty-state"><div className="empty-die"><Dices size={22}/></div><strong>Le silence avant le premier jet</strong><span>Les lancers de la table apparaîtront ici.</span></div>}</div></section>
}
function RollItem({ roll }: { roll: Roll }) {
  const natural = roll.detail?.natural ?? (roll.notation.toLowerCase() === '1d20' ? roll.dice[0] : null)
  const critical = natural === 20 ? 'natural-twenty' : natural === 1 ? 'natural-one' : ''
  return <div className={`roll-row ${critical}`}><div className="roll-mark"><Dices size={16}/></div><div className="roll-info"><strong>{roll.display_name}{roll.character_name ? <span> · {roll.character_name}</span> : null}</strong><small>{roll.detail ? `${roll.detail.action} · ${roll.detail.stat}` : roll.notation.toUpperCase()} <i>·</i> {dateLabel(roll.created_at)}</small></div><div className="roll-result"><span>{roll.dice.join(' + ')}{roll.modifier ? ` ${roll.modifier > 0 ? '+' : '−'} ${Math.abs(roll.modifier)}` : ''}</span><strong>{roll.total}</strong></div>{roll.detail && <span className={`verdict-chip ${verdictClass[roll.detail.verdict]}`}>{verdictLabel[roll.detail.verdict]}</span>}{!roll.detail && natural === 20 && <span className="natural-chip">20 NATUREL</span>}{!roll.detail && natural === 1 && <span className="natural-chip bad">1 NATUREL</span>}</div>
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
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) { onToast('Formats acceptés : JPG, PNG, GIF et WebP.'); return }
    if (file.size > 10 * 1024 * 1024) { onToast('Une image doit faire 10 Mo maximum.'); return }
    try {
      const preview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('Lecture de l’image impossible.'))
        reader.readAsDataURL(file)
      })
      setPendingPortrait({ name: file.name, contentType: file.type, data: preview.split(',')[1] || '', preview })
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

