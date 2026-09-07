import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  Inbox,
  LifeBuoy,
  Link2,
  LockKeyhole,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  UserPlus,
} from 'lucide-react';
import { CapabilityBadge } from './CapabilityBadge';
import { communicationService } from '../lib/communicationService';
import {
  CAPABILITY_BADGES,
  CommunicationActor,
  CommunicationConversation,
  CommunicationHubSnapshot,
  ContactChannel,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PURPOSES,
  NotificationChannel,
  NotificationPurpose,
  PURPOSE_LABELS,
  ReviewArtifactType,
  SUPPORT_CATEGORY_LABELS,
  SupportCategory,
  TenantCapability,
  buildPreferenceMatrix,
  isSafeOverviewLabel,
  resolvePrivyDocPortalUrl,
} from '../lib/communicationDomain';

interface CommunicationHubViewProps {
  actor: CommunicationActor;
}

const EMPTY_SNAPSHOT: CommunicationHubSnapshot = {
  actor: { kind: 'WORKFORCE', id: '', name: '', tenant_id: null },
  contacts: [],
  preferences: [],
  capabilities: [],
  conversations: [],
  invitations: [],
  reviewable_artifacts: [],
  eligible_members: [],
  deliveries: [],
  privydoc_linkage: { state: 'NOT_LINKED', evidence_reference: null },
  external_delivery: { whatsapp: 'DISABLED', email: 'DISABLED' },
};

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  IN_APP: 'In-app',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const CommunicationHubView: React.FC<CommunicationHubViewProps> = ({ actor }) => {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState(actor.accessCode || '');
  const [snapshot, setSnapshot] = useState<CommunicationHubSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [whatsApp, setWhatsApp] = useState('');
  const [email, setEmail] = useState('');
  const [supportCategory, setSupportCategory] = useState<SupportCategory>('TECHNICAL_PROBLEM');
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [artifactKey, setArtifactKey] = useState('');
  const [inviteeId, setInviteeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [coordinationTarget, setCoordinationTarget] = useState('');
  const [coordinationCapability, setCoordinationCapability] = useState<TenantCapability>('ROSTER_COORDINATE');
  const [coordinationSubject, setCoordinationSubject] = useState('');
  const [coordinationMessage, setCoordinationMessage] = useState('');

  const activeCode = actor.kind === 'WORKFORCE' ? (accessCode || null) : null;
  const preferenceMatrix = useMemo(() => buildPreferenceMatrix(snapshot.preferences), [snapshot.preferences]);
  const selectedConversation = snapshot.conversations.find(conversation => conversation.id === selectedConversationId) || null;
  const coordinationCapabilities = snapshot.capabilities.filter(capability => capability !== 'MEMBER_SUPPORT');
  const privyDocUrl = resolvePrivyDocPortalUrl(import.meta.env.VITE_PRIVYDOC_PORTAL_URL);

  const load = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError('');
    try {
      const next = await communicationService.getHub(actor, activeCode);
      setSnapshot(next);
      setLoaded(true);
      setSelectedConversationId(current => current && next.conversations.some(item => item.id === current) ? current : next.conversations[0]?.id ?? null);
      if (next.capabilities.length > 0 && !next.capabilities.includes(coordinationCapability)) {
        setCoordinationCapability(next.capabilities[0]);
      }
    } catch (err) {
      setLoaded(false);
      setError(err instanceof Error ? err.message : 'Communication Hub could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (actor.kind === 'DOCTOR' || actor.accessCode) load();
    // Actor identity is fixed for the lifetime of this authenticated route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.id]);

  const run = async (operation: () => Promise<void>, message: string) => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await operation();
      await load(false);
      setSuccess(message);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The operation could not be completed.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const saveContact = async (channel: ContactChannel) => {
    const value = channel === 'WHATSAPP' ? whatsApp : email;
    const saved = await run(() => communicationService.saveContact(actor, channel, value, activeCode), `${channel === 'WHATSAPP' ? 'WhatsApp number' : 'Email address'} saved as unverified.`);
    if (saved) {
      if (channel === 'WHATSAPP') setWhatsApp(''); else setEmail('');
    }
  };

  const selectConversation = async (conversation: CommunicationConversation) => {
    setSelectedConversationId(conversation.id);
    if (conversation.unread_count > 0) {
      try {
        await communicationService.markRead(actor, conversation.id, activeCode);
        await load(false);
      } catch {
        setError('The conversation opened, but its read state could not be saved.');
      }
    }
  };

  if (!loaded && actor.kind === 'WORKFORCE' && !actor.accessCode) {
    return (
      <div className="mx-auto my-10 max-w-md px-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LockKeyhole className="text-blue-600" size={22} />
          <h2 className="mt-3 text-lg font-bold text-slate-900">Unlock Communication Hub</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">For a restored legacy member session, re-enter your normal access code. It is used only for this server-verified request and is not stored.</p>
          <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); load(); }}>
            <input type="password" inputMode="numeric" value={accessCode} onChange={event => setAccessCode(event.target.value)} placeholder="Member access code" className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" autoComplete="off" />
            {error && <p className="text-xs text-rose-700" role="alert">{error}</p>}
            <button type="submit" disabled={loading || !accessCode} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? 'Checking…' : 'Continue'}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto my-8 max-w-6xl space-y-6 px-4">
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><MessageSquare size={19} className="text-blue-600" /><h2 className="text-lg font-bold text-slate-900">Communication Hub</h2></div>
            <p className="mt-1 text-xs text-slate-500">Governed messages, review invitations, support and notification choices.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-slate-800">{snapshot.actor.name || actor.name}</span>
              {snapshot.capabilities.map(capability => <CapabilityBadge key={capability} capability={capability} />)}
            </div>
          </div>
          <button type="button" onClick={() => load()} disabled={loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
        {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}
        {success && <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800" role="status"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />{success}</div>}
      </header>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2"><Bell size={16} className="text-slate-500" /><h3 className="text-sm font-bold text-slate-900">Contact & notifications</h3></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Saving contact information does not enable a channel or verify ownership. Choose each purpose independently below.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['WHATSAPP', 'EMAIL'] as ContactChannel[]).map(channel => {
              const contact = snapshot.contacts.find(item => item.channel === channel);
              const value = channel === 'WHATSAPP' ? whatsApp : email;
              return (
                <div key={channel} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2">{channel === 'WHATSAPP' ? <Smartphone size={15} /> : <Mail size={15} />}<h4 className="text-xs font-bold text-slate-800">{channel === 'WHATSAPP' ? 'WhatsApp number' : 'Email address'}</h4></div>
                  <p className="mt-1 text-[11px] text-slate-500">{contact ? `${contact.masked_value} · ${contact.verification_state.replaceAll('_', ' ').toLowerCase()}` : 'Not provided'}</p>
                  <input type={channel === 'EMAIL' ? 'email' : 'tel'} value={value} onChange={event => channel === 'WHATSAPP' ? setWhatsApp(event.target.value) : setEmail(event.target.value)} placeholder={channel === 'WHATSAPP' ? 'International E.164 format' : 'you@example.com'} className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => saveContact(channel)} disabled={loading || !value.trim()} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Save</button>
                    {contact && contact.verification_state === 'UNVERIFIED' && (
                      <button type="button" onClick={() => run(() => communicationService.requestContactVerification(actor, channel, activeCode), 'Verification is pending; no message was sent because the provider is disabled.' )} disabled={loading} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Record pending verification</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead><tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500"><th className="py-2 pr-3">Purpose</th>{NOTIFICATION_CHANNELS.map(channel => <th key={channel} className="px-3 py-2 text-center">{CHANNEL_LABELS[channel]}</th>)}</tr></thead>
              <tbody>{NOTIFICATION_PURPOSES.map(purpose => (
                <tr key={purpose} className="border-b border-slate-100"><td className="py-3 pr-3 font-semibold text-slate-700">{PURPOSE_LABELS[purpose]}</td>{NOTIFICATION_CHANNELS.map(channel => (
                  <td key={channel} className="px-3 py-3 text-center"><input type="checkbox" aria-label={`${PURPOSE_LABELS[purpose]} via ${CHANNEL_LABELS[channel]}`} checked={preferenceMatrix[`${purpose}:${channel}`]} onChange={event => run(() => communicationService.setPreference(actor, purpose, channel, event.target.checked, activeCode), 'Notification preference saved.')} disabled={loading} /></td>
                ))}</tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Essential in-app account and safety notices may still appear. Product-feature releases are never treated as operational notices. Email and WhatsApp delivery are not yet activated.</p>
        </div>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2"><Link2 size={16} className="text-blue-600" /><h3 className="text-sm font-bold text-slate-900">PrivyDoc access</h3></div>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">PrivyDoc is a separate clinical service with a separate session, roles and data boundary. Workspc sends no phone number, email, patient data or token when you open it.</p>
            <p className="mt-3 text-[11px] font-semibold text-slate-600">Linkage: {snapshot.privydoc_linkage.state.replaceAll('_', ' ').toLowerCase()}</p>
            <a href={privyDocUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700">Open PrivyDoc <ExternalLink size={12} /></a>
            <p className="mt-2 text-[10px] text-slate-400">Verified phone-based linking is unavailable until a separately reviewed identity contract exists.</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
            <p className="font-bold">External delivery is dormant</p>
            <p className="mt-1 leading-relaxed">Meta WhatsApp: disabled · Resend email: disabled. In-app delivery remains available. Disabled external outcomes are recorded without contact values or message bodies.</p>
          </div>
        </aside>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><Inbox size={16} className="text-slate-500" /><h3 className="text-sm font-bold text-slate-900">Inbox</h3></div>
          <div className="mt-3 space-y-2">
            {snapshot.conversations.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No conversations yet.</p> : snapshot.conversations.map(conversation => (
              <button key={conversation.id} type="button" onClick={() => selectConversation(conversation)} className={`w-full rounded-xl border p-3 text-left ${selectedConversationId === conversation.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-800">{conversation.subject}</span>{conversation.unread_count > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">{conversation.unread_count}</span>}</div>
                <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">{conversation.kind} · {conversation.status} · {formatTimestamp(conversation.updated_at)}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          {!selectedConversation ? <p className="text-sm text-slate-500">Select a conversation to read it.</p> : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3"><div><h3 className="text-sm font-bold text-slate-900">{selectedConversation.subject}</h3><p className="text-[10px] uppercase tracking-wider text-slate-500">{selectedConversation.kind} · {selectedConversation.status}</p></div>{selectedConversation.status === 'OPEN' && <button type="button" onClick={() => run(() => communicationService.closeConversation(actor, selectedConversation.id, activeCode), 'Conversation closed.')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-600">Close</button>}</div>
              <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">
                {selectedConversation.messages.map(message => <div key={message.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-slate-800">{message.sender_name}</p><time className="text-[10px] text-slate-400">{formatTimestamp(message.created_at)}</time></div><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{message.body}</p>{message.safe_route && <button type="button" onClick={() => navigate(message.safe_route as string)} className="mt-2 text-xs font-bold text-blue-600">Open related Workspc surface</button>}</div>)}
              </div>
              {selectedConversation.status === 'OPEN' && <form className="mt-4 flex gap-2" onSubmit={event => { event.preventDefault(); if (!reply.trim()) return; run(() => communicationService.reply(actor, selectedConversation.id, reply, activeCode), 'Reply sent in-app.').then(sent => { if (sent) setReply(''); }); }}><textarea rows={2} maxLength={2000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Write an in-app reply" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm" /><button type="submit" disabled={loading || !reply.trim()} aria-label="Send reply" className="self-end rounded-xl bg-blue-600 p-2.5 text-white disabled:opacity-50"><Send size={15} /></button></form>}
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={event => { event.preventDefault(); if (!isSafeOverviewLabel(supportSubject)) return setError('Use a concise subject without contact details, URLs, tokens or secrets.'); run(async () => { await communicationService.startSupport(actor, supportCategory, supportSubject, supportMessage, activeCode); }, 'Support conversation created.').then(created => { if (created) { setSupportSubject(''); setSupportMessage(''); } }); }}>
          <div className="flex items-center gap-2"><LifeBuoy size={16} className="text-blue-600" /><h3 className="text-sm font-bold text-slate-900">Support & feedback</h3></div>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Workspc support is not an emergency or clinical consultation channel. Do not include patient identifiers, diagnoses or clinical narratives.</p>
          <select value={supportCategory} onChange={event => setSupportCategory(event.target.value as SupportCategory)} className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">{Object.entries(SUPPORT_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <input value={supportSubject} onChange={event => setSupportSubject(event.target.value)} maxLength={120} placeholder="Concise subject" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <textarea value={supportMessage} onChange={event => setSupportMessage(event.target.value)} maxLength={2000} rows={4} placeholder="Describe the Workspc issue without sensitive clinical information" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={loading || !supportSubject.trim() || !supportMessage.trim()} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Send size={12} /> Start support conversation</button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><UserPlus size={16} className="text-blue-600" /><h3 className="text-sm font-bold text-slate-900">Invite to review</h3></div>
          {actor.kind === 'DOCTOR' || snapshot.reviewable_artifacts.length === 0 ? <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No tenant-owned artifact with a safe invitation contract is currently available.</p> : <form className="mt-4 space-y-2" onSubmit={event => { event.preventDefault(); const [artifactType, artifactId] = artifactKey.split(':') as [ReviewArtifactType, string]; if (!artifactId || !inviteeId) return; run(async () => { await communicationService.createReviewInvitation(actor, inviteeId, artifactType, artifactId, dueDate || null, activeCode); }, 'Review invitation created. Opening it will not mark it complete.').then(created => { if (created) { setArtifactKey(''); setInviteeId(''); setDueDate(''); } }); }}>
            <select value={artifactKey} onChange={event => setArtifactKey(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select your work…</option>{snapshot.reviewable_artifacts.map(artifact => <option key={`${artifact.artifact_type}:${artifact.artifact_id}`} value={`${artifact.artifact_type}:${artifact.artifact_id}`}>{artifact.safe_label}</option>)}</select>
            <select value={inviteeId} onChange={event => setInviteeId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select a same-tenant reviewer…</option>{snapshot.eligible_members.map(member => <option key={member.workforce_id} value={member.workforce_id}>{member.full_name} — {member.category}</option>)}</select>
            <label className="block text-xs font-semibold text-slate-600">Optional due date<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <button type="submit" disabled={loading || !artifactKey || !inviteeId} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Create invitation</button>
          </form>}
          <div className="mt-4 space-y-2">{snapshot.invitations.map(invitation => <div key={invitation.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold text-slate-800">{invitation.safe_label}</p><span className="text-[10px] font-bold text-slate-500">{invitation.status}</span></div><p className="mt-1 text-[11px] text-slate-500">{invitation.viewer_role === 'INVITER' ? `Invited ${invitation.invitee_name}` : `From ${invitation.inviter_name}`} · Review access: {invitation.permission_state === 'AVAILABLE' ? 'available' : 'pending owner-safe permission seam'}</p><div className="mt-2 flex flex-wrap gap-2">{invitation.viewer_role === 'INVITEE' && invitation.status === 'PENDING' && <><button type="button" onClick={() => run(() => communicationService.respondToInvitation(actor, invitation.id, 'ACCEPTED', activeCode), 'Invitation accepted.')} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">Accept</button><button type="button" onClick={() => run(() => communicationService.respondToInvitation(actor, invitation.id, 'DECLINED', activeCode), 'Invitation declined.')} className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-600">Decline</button></>}{invitation.viewer_role === 'INVITEE' && invitation.status === 'ACCEPTED' && invitation.permission_state === 'AVAILABLE' && <><button type="button" onClick={() => navigate(invitation.safe_route)} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">Open review surface</button><button type="button" onClick={() => run(() => communicationService.respondToInvitation(actor, invitation.id, 'COMPLETED', activeCode), 'Review explicitly marked complete.')} className="rounded-lg bg-slate-950 px-2.5 py-1 text-[11px] font-bold text-white">Mark completed</button></>}{invitation.viewer_role === 'INVITER' && ['PENDING', 'ACCEPTED'].includes(invitation.status) && <button type="button" onClick={() => run(() => communicationService.respondToInvitation(actor, invitation.id, 'CANCELLED', activeCode), 'Invitation cancelled.')} className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-700">Cancel</button>}</div></div>)}</div>
        </div>
      </section>

      {coordinationCapabilities.length > 0 && (
        <form className="rounded-2xl border border-blue-200 bg-blue-50 p-5 shadow-sm" onSubmit={event => { event.preventDefault(); if (!isSafeOverviewLabel(coordinationSubject)) return setError('Use a concise subject without contact details, URLs, tokens or secrets.'); run(async () => { await communicationService.startCoordination(actor, coordinationTarget, coordinationCapability, coordinationSubject, coordinationMessage, activeCode); }, 'Governed coordination conversation created.').then(created => { if (created) { setCoordinationTarget(''); setCoordinationSubject(''); setCoordinationMessage(''); } }); }}>
          <div className="flex items-center gap-2"><ShieldCheck size={16} className="text-blue-700" /><h3 className="text-sm font-bold text-blue-950">Delegated coordination</h3></div>
          <p className="mt-1 text-xs text-blue-800">Only controls backed by your active tenant capability are shown. This does not grant tenant-admin or database authority.</p>
          <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
            <select value={coordinationCapability} onChange={event => setCoordinationCapability(event.target.value as TenantCapability)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm">{coordinationCapabilities.map(value => <option key={value} value={value}>{CAPABILITY_BADGES[value].label}</option>)}</select>
            <select value={coordinationTarget} onChange={event => setCoordinationTarget(event.target.value)} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"><option value="">Select an eligible tenant member…</option>{snapshot.eligible_members.map(member => <option key={member.workforce_id} value={member.workforce_id}>{member.full_name}</option>)}</select>
            <input value={coordinationSubject} onChange={event => setCoordinationSubject(event.target.value)} maxLength={120} placeholder="Safe coordination subject" className="rounded-lg border border-blue-200 px-3 py-2 text-sm" />
            <input value={coordinationMessage} onChange={event => setCoordinationMessage(event.target.value)} maxLength={2000} placeholder="In-app coordination message" className="rounded-lg border border-blue-200 px-3 py-2 text-sm" />
          </div>
          <button type="submit" disabled={loading || !coordinationTarget || !coordinationSubject.trim() || !coordinationMessage.trim()} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><Send size={12} /> Send governed message</button>
        </form>
      )}

      {snapshot.deliveries.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold text-slate-900">Recent delivery state</h3><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{snapshot.deliveries.map((delivery, index) => <div key={`${delivery.channel}:${delivery.updated_at}:${index}`} className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-800">{CHANNEL_LABELS[delivery.channel]} · {delivery.outcome}</p><p className="mt-1 text-[10px] text-slate-500">{delivery.failure_classification === 'PROVIDER_DISABLED' ? 'Delivery not yet activated' : 'Recorded without message body or contact detail'}</p></div>)}</div></section>}
    </div>
  );
};
