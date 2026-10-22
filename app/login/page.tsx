import React from 'react';
import type { Metadata } from 'next';
import AuthForm from '@/components/AuthForm';

export const metadata: Metadata = {
  title: 'Đăng nhập — NALESE AI Language Tutor',
  description: 'Đăng nhập vào NALESE để lưu tiến độ học tập và luyện đàm thoại với gia sư AI.',
};

export default function LoginPage() {
  return (
    <main className="min-h-[100dvh] w-full flex items-center justify-center p-6 max-[480px]:p-4 bg-[var(--bg)]">
      <div className="w-full max-w-[440px] bg-[var(--card)] border border-[var(--border)] rounded-[16px] p-[32px] max-[480px]:p-[24px] shadow-none">
        {/* Logo & Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-[88px] h-[88px] max-[480px]:w-[72px] max-[480px]:h-[72px] rounded-full overflow-hidden border border-[var(--border)] mb-4 shadow-none flex items-center justify-center bg-transparent">
            <img
              src="/logo-circle.png"
              alt="NALESE Logo"
              className="w-full h-full object-cover"
            />
          </div>
          <h1 className="text-[28px] max-[480px]:text-[24px] font-bold text-[var(--text)] tracking-tight leading-tight">
            NALESE
          </h1>
        </div>

        {/* Form xác thực Email & Mật khẩu */}
        <AuthForm defaultMode="signin" />
      </div>
    </main>
  );
}
