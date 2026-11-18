import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const apiOrigin = (process.env.FILTROX_API_ORIGIN ?? '').trim().replace(/\/$/, '');
  let upstreamCookie: string | null = null;

  if (apiOrigin) {
    try {
      const upstream = await fetch(`${apiOrigin}/auth/logout`, {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
        cache: 'no-store',
        redirect: 'manual',
      });
      upstreamCookie = upstream.headers.get('set-cookie');
    } catch {
      // Clear the browser cookie below even when the API is unreachable.
    }
  }

  const response = NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'no-store, private, max-age=0' } });
  if (upstreamCookie) {
    response.headers.set('Set-Cookie', upstreamCookie);
  } else {
    response.cookies.set({
      name: 'filtrox_session',
      value: '',
      httpOnly: true,
      secure: process.env.FILTROX_ENVIRONMENT === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0,
    });
  }
  return response;
}
