// lib/supabase/middleware.ts
// Hàm updateSession làm mới phiên đăng nhập qua cookie và chuyển hướng bảo vệ route
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';

  // Nếu chưa cấu hình Supabase URL/Key thì bỏ qua để không gây vòng lặp chuyển hướng
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // Quan trọng: Gọi getUser() để refresh auth cookie hợp lệ
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === '/login' || pathname.startsWith('/login/');
  const isAuthCallback = pathname.startsWith('/auth');
  const isApiRoute = pathname.startsWith('/api');

  // 1. Chưa đăng nhập mà truy cập trang ứng dụng -> chuyển hướng về /login
  if (!user && !isLoginPage && !isAuthCallback && !isApiRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    const redirectResponse = NextResponse.redirect(url);
    // Bảo tồn cookies từ supabaseResponse sang redirect response
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }

  // 2. Đã đăng nhập mà vào lại /login -> chuyển hướng về trang chủ /
  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}
