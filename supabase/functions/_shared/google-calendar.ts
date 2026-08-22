// Cliente Google Calendar para a conta única compartilhada usada por todos os
// departamentos ("Gmail fixo" pedido pelo usuário). Uma conexão OAuth só —
// não há credencial por departamento.
//
// Não existe fluxo de "Conectar com Google" nesta versão (exigiria uma tela
// de consentimento OAuth publicada e um callback público testado ao vivo).
// Em vez disso, as três credenciais (client id/secret + refresh token) são
// coladas manualmente em /settings/credentials — o refresh token é obtido uma
// vez via https://developers.google.com/oauthplayground (escopo
// https://www.googleapis.com/auth/calendar), o mesmo caminho documentado no
// helpText do campo em setup.config.ts. Se algum dia a instalação quiser um
// botão de conectar de verdade, essa troca (auth code → tokens) é a mesma
// usada aqui pra refresh token → access token.

import { getCredentials } from './credentials.ts';

interface GoogleOAuthCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function loadGoogleCreds(): Promise<GoogleOAuthCreds | null> {
  const values = await getCredentials([
    'google_oauth_client_id',
    'google_oauth_client_secret',
    'google_oauth_refresh_token',
  ]);
  const clientId = values.google_oauth_client_id?.trim();
  const clientSecret = values.google_oauth_client_secret?.trim();
  const refreshToken = values.google_oauth_refresh_token?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

// access_token de curta duração (1h), trocado a cada chamada — sem cache
// entre invocações porque cada Edge Function roda em isolate próprio e o
// custo de um POST extra é desprezível perto de criar/apagar um evento.
async function getAccessToken(creds: GoogleOAuthCreds): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google OAuth refresh falhou (HTTP ${res.status}): ${body}`);
  }
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google OAuth não devolveu access_token.');
  return body.access_token;
}

export interface CreateMeetEventInput {
  title: string;
  description?: string | null;
  startsAtIso: string;
  endsAtIso: string;
  attendees: string[]; // e-mails
}

export interface CreateMeetEventResult {
  eventId: string;
  meetLink: string | null;
}

// POST /calendars/primary/events com conferenceDataVersion=1 gera o link do
// Meet automaticamente — funciona em conta Google comum, sem Workspace.
export async function createMeetEvent(input: CreateMeetEventInput): Promise<CreateMeetEventResult> {
  const creds = await loadGoogleCreds();
  if (!creds) {
    throw new Error(
      'Credenciais do Google não configuradas (google_oauth_client_id/client_secret/refresh_token). ' +
        'Configure em /settings/credentials.',
    );
  }
  const accessToken = await getAccessToken(creds);

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description ?? undefined,
        start: { dateTime: input.startsAtIso },
        end: { dateTime: input.endsAtIso },
        attendees: input.attendees.map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar HTTP ${res.status}: ${body}`);
  }
  const body = (await res.json()) as {
    id?: string;
    hangoutLink?: string;
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  };
  if (!body.id) throw new Error('Google Calendar não devolveu o id do evento criado.');
  const meetEntry = body.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video');
  return { eventId: body.id, meetLink: body.hangoutLink ?? meetEntry?.uri ?? null };
}

// Best-effort: cancelar reunião não deve falhar por causa de um evento que já
// não existe mais (apagado manualmente na agenda, por exemplo).
export async function deleteMeetEvent(eventId: string): Promise<void> {
  const creds = await loadGoogleCreds();
  if (!creds) return;
  try {
    const accessToken = await getAccessToken(creds);
    await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } catch {
    // Best-effort — ver comentário acima.
  }
}
