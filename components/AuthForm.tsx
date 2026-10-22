'use client';
// ============================================================
// components/AuthForm.tsx — Form đăng nhập & đăng ký Email/Mật khẩu
// Tông màu kem đào đồng bộ NALESE, không có nút Google
// ============================================================

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, User, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface AuthFormProps {
  defaultMode?: 'signin' | 'signup';
  onSuccess?: () => void;
  isModal?: boolean;
}

export default function AuthForm({
  defaultMode = 'signin',
  onSuccess,
  isModal = false,
}: AuthFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>(defaultMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const switchMode = (newMode: 'signin' | 'signup') => {
    setMode(newMode);
    setError(null);
    setSuccessMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    const supabase = createClient();

    try {
      if (mode === 'signin') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) {
          const msg = signInError.message.toLowerCase();
          if (msg.includes('invalid login credentials') || msg.includes('invalid credentials')) {
            throw new Error('Email hoặc mật khẩu không chính xác.');
          } else if (msg.includes('email not confirmed')) {
            throw new Error('Email chưa được xác thực. Vui lòng kiểm tra hộp thư của bạn.');
          } else if (msg.includes('rate limit')) {
            throw new Error('Quá nhiều lần thử thất bại. Vui lòng thử lại sau vài phút.');
          } else {
            throw new Error(signInError.message || 'Đăng nhập không thành công.');
          }
        }

        setSuccessMsg('Đăng nhập thành công! Đang chuyển hướng...');
        if (onSuccess) {
          onSuccess();
        } else {
          router.push('/');
          router.refresh();
        }
      } else {
        // Sign Up
        if (password.length < 6) {
          throw new Error('Mật khẩu phải có tối thiểu 6 ký tự.');
        }

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim() || email.split('@')[0],
            },
          },
        });

        if (signUpError) {
          const msg = signUpError.message.toLowerCase();
          if (msg.includes('already registered') || msg.includes('user already exists')) {
            throw new Error('Email này đã được sử dụng. Vui lòng chọn đăng nhập.');
          } else if (msg.includes('password should be at least')) {
            throw new Error('Mật khẩu quá ngắn. Cần ít nhất 6 ký tự.');
          } else {
            throw new Error(signUpError.message || 'Đăng ký không thành công.');
          }
        }

        if (signUpData.session) {
          // Supabase không bật Email Confirmation -> Đăng nhập ngay
          setSuccessMsg('Đăng ký thành công! Đang chuyển hướng...');
          setTimeout(() => {
            if (onSuccess) {
              onSuccess();
            } else {
              router.push('/');
              router.refresh();
            }
          }, 600);
        } else {
          // Supabase bật Email Confirmation
          setSuccessMsg(
            'Tài khoản đã tạo thành công! Nếu được yêu cầu xác thực, vui lòng kiểm tra hộp thư đến của bạn để kích hoạt.'
          );
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      {/* Thanh chuyển tab Đăng nhập / Đăng ký (Segmented) */}
      <div className="grid grid-cols-2 p-[4px] rounded-[12px] bg-[var(--bg)] border border-[var(--border)] mb-6">
        <button
          type="button"
          onClick={() => switchMode('signin')}
          className={`h-[40px] text-[15px] font-semibold rounded-[8px] transition-all duration-150 ease-out cursor-pointer flex items-center justify-center ${mode === 'signin'
            ? 'bg-[var(--card)] text-[var(--accent)] border border-[var(--border)] shadow-none'
            : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)] border border-transparent'
            }`}
        >
          Đăng nhập
        </button>
        <button
          type="button"
          onClick={() => switchMode('signup')}
          className={`h-[40px] text-[15px] font-semibold rounded-[8px] transition-all duration-150 ease-out cursor-pointer flex items-center justify-center ${mode === 'signup'
            ? 'bg-[var(--card)] text-[var(--accent)] border border-[var(--border)] shadow-none'
            : 'bg-transparent text-[var(--muted)] hover:text-[var(--text)] border border-transparent'
            }`}
        >
          Đăng ký
        </button>
      </div>

      {/* Vùng nội dung form: dùng grid-area 1/1 để thẻ giữ chiều cao cố định theo form Đăng ký, không nhảy giật khi chuyển tab */}
      <div className="grid grid-cols-1">
        {/* Tab Đăng nhập */}
        <div
          className={`col-start-1 row-start-1 w-full transition-opacity duration-150 ${mode === 'signin'
            ? 'visible opacity-100 z-10'
            : 'invisible opacity-0 pointer-events-none -z-10'
            }`}
          aria-hidden={mode !== 'signin'}
          inert={mode !== 'signin'}
        >
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="flex flex-col gap-4">
              {/* Email */}
              <div>
                <label
                  htmlFor="signin-email"
                  className="block text-[13px] font-semibold text-[var(--muted)] mb-[6px]"
                >
                  Email
                </label>
                <div className="relative flex items-center">
                  <Mail
                    size={18}
                    className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <input
                    id="signin-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-input-with-icon w-full h-[48px] pl-[44px] pr-4 rounded-[10px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] shadow-none transition-colors"
                  />
                </div>
              </div>

              {/* Mật khẩu */}
              <div>
                <label
                  htmlFor="signin-password"
                  className="block text-[13px] font-semibold text-[var(--muted)] mb-[6px]"
                >
                  Mật khẩu
                </label>
                <div className="relative flex items-center">
                  <Lock
                    size={18}
                    className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <input
                    id="signin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input-with-icon auth-input-password w-full h-[48px] pl-[44px] pr-[48px] rounded-[10px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] shadow-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[36px] h-[36px] flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition-colors focus:outline-none cursor-pointer"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {/* Link Quên mật khẩu nằm bên phải ngay dưới ô mật khẩu */}
                <div className="flex justify-end mt-[6px]">
                  <button
                    type="button"
                    onClick={() => {
                      setError('Vui lòng liên hệ admin để khôi phục mật khẩu.');
                    }}
                    className="text-[13px] text-[var(--accent)] hover:underline focus:outline-none cursor-pointer"
                  >
                    Quên mật khẩu?
                  </button>
                </div>
              </div>
            </div>

            {/* Thông báo lỗi */}
            {error && mode === 'signin' && (
              <div
                role="alert"
                aria-live="polite"
                className="mt-4 py-[10px] px-[14px] rounded-[10px] bg-[#FDECEC] border border-[var(--danger)] text-[var(--danger)] text-[14px] flex items-center gap-2"
              >
                <AlertCircle size={16} className="shrink-0 text-[var(--danger)]" />
                <span>{error}</span>
              </div>
            )}

            {/* Thông báo thành công */}
            {successMsg && mode === 'signin' && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 py-[10px] px-[14px] rounded-[10px] bg-emerald-50 border border-emerald-300 text-emerald-800 text-[14px] flex items-center gap-2"
              >
                <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Nút chính */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-[48px] rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[15px] font-semibold mt-6 flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <span>Đăng nhập</span>
              )}
            </button>

            {/* Dòng chuyển tab phía dưới nút */}
            <p className="text-center text-[14px] text-[var(--muted)] mt-5">
              Chưa có tài khoản?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-[var(--accent)] font-semibold hover:underline focus:outline-none cursor-pointer"
              >
                Đăng ký ngay
              </button>
            </p>
          </form>
        </div>

        {/* Tab Đăng ký */}
        <div
          className={`col-start-1 row-start-1 w-full transition-opacity duration-150 ${mode === 'signup'
            ? 'visible opacity-100 z-10'
            : 'invisible opacity-0 pointer-events-none -z-10'
            }`}
          aria-hidden={mode !== 'signup'}
          inert={mode !== 'signup'}
        >
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="flex flex-col gap-4">
              {/* Họ và tên */}
              <div>
                <label
                  htmlFor="signup-name"
                  className="block text-[13px] font-semibold text-[var(--muted)] mb-[6px]"
                >
                  Họ và tên
                </label>
                <div className="relative flex items-center">
                  <User
                    size={18}
                    className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <input
                    id="signup-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="auth-input-with-icon w-full h-[48px] pl-[44px] pr-4 rounded-[10px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] shadow-none transition-colors"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-[13px] font-semibold text-[var(--muted)] mb-[6px]"
                >
                  Email
                </label>
                <div className="relative flex items-center">
                  <Mail
                    size={18}
                    className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <input
                    id="signup-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="auth-input-with-icon w-full h-[48px] pl-[44px] pr-4 rounded-[10px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] shadow-none transition-colors"
                  />
                </div>
              </div>

              {/* Mật khẩu */}
              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-[13px] font-semibold text-[var(--muted)] mb-[6px]"
                >
                  Mật khẩu
                </label>
                <div className="relative flex items-center">
                  <Lock
                    size={18}
                    className="absolute left-[14px] top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none"
                  />
                  <input
                    id="signup-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input-with-icon auth-input-password w-full h-[48px] pl-[44px] pr-[48px] rounded-[10px] border border-[var(--border)] bg-[var(--card)] text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] shadow-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-[6px] top-1/2 -translate-y-1/2 w-[36px] h-[36px] flex items-center justify-center rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg)] transition-colors focus:outline-none cursor-pointer"
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {/* Dòng gợi ý khớp đúng quy tắc tối thiểu 6 ký tự trong code */}
                <p className="text-[12px] text-[var(--muted)] mt-[6px]">
                  Tối thiểu 6 ký tự
                </p>
              </div>
            </div>

            {/* Thông báo lỗi */}
            {error && mode === 'signup' && (
              <div
                role="alert"
                aria-live="polite"
                className="mt-4 py-[10px] px-[14px] rounded-[10px] bg-[#FDECEC] border border-[var(--danger)] text-[var(--danger)] text-[14px] flex items-center gap-2"
              >
                <AlertCircle size={16} className="shrink-0 text-[var(--danger)]" />
                <span>{error}</span>
              </div>
            )}

            {/* Thông báo thành công */}
            {successMsg && mode === 'signup' && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 py-[10px] px-[14px] rounded-[10px] bg-emerald-50 border border-emerald-300 text-emerald-800 text-[14px] flex items-center gap-2"
              >
                <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Nút chính */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-[48px] rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[15px] font-semibold mt-6 flex items-center justify-center gap-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : (
                <span>Tạo tài khoản</span>
              )}
            </button>

            {/* Dòng chuyển tab phía dưới nút */}
            <p className="text-center text-[14px] text-[var(--muted)] mt-5">
              Đã có tài khoản?{' '}
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="text-[var(--accent)] font-semibold hover:underline focus:outline-none cursor-pointer"
              >
                Đăng nhập
              </button>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
