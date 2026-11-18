import { NextRequest, NextResponse } from 'next/server';
import { isValidSessionToken, refreshSessionToken, SESSION_COOKIE_NAME, SESSION_IDLE_TTL_SECONDS } from './lib/server-session';

const PUBLIC_PAGE_PATHS = new Set(['/login']);
const PUBLIC_AUTH_PATHS = new Set(['/auth/login', '/auth/logout']);
const API_PATHS = ['/v1/', '/healthz'];
const STATIC_PATHS = ['/_next/', '/favicon.ico', '/filtrox-mark.svg', '/robots.txt', '/sitemap.xml'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    PUBLIC_PAGE_PATHS.has(pathname)
    || PUBLIC_AUTH_PATHS.has(pathname)
    || API_PATHS.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))
    || STATIC_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (isValidSessionToken(token)) {
    const refreshedToken = refreshSessionToken(token);
    if (refreshedToken) {
      const response = NextResponse.next();
      response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: refreshedToken,
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
        sameSite: 'strict',
        path: '/',
        maxAge: SESSION_IDLE_TTL_SECONDS,
      });
      return response;
    }
  }

  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|filtrox-mark.svg|robots.txt|sitemap.xml).*)'],
};
