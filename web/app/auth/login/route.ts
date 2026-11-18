import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const apiOrigin = (process.env.FILTROX_API_ORIGIN ?? '').trim().replace(/\/$/, '');
  if (!apiOrigin) {
    return NextResponse.json({ detail: 'O serviço de login não está configurado.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const body = await request.text();
    if (body.length > 2048) {
      return NextResponse.json({ detail: 'Requisição de login inválida.' }, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    }
    const upstream = await fetch(`${apiOrigin}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      cache: 'no-store',
      redirect: 'manual',
    });
    const payload = await upstream.json().catch(() => ({ detail: 'Não foi possível autenticar.' }));
    const response = NextResponse.json(payload, {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store, private, max-age=0' },
    });
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) response.headers.set('Set-Cookie', setCookie);
    return response;
  } catch {
    return NextResponse.json({ detail: 'O serviço de login está indisponível.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
