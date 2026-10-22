// scripts/check-supabase.ts
// Script kiểm tra cấu hình và kết nối Supabase
// CHỈ in kết quả, KHÔNG BAO GIỜ in giá trị của bất kỳ khóa nào.

import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

async function main() {
  console.log('========================================================');
  console.log('KIỂM TRA CẤU HÌNH SUPABASE (NALESE)');
  console.log('========================================================\n');

  // a) Kiểm tra sự tồn tại của biến môi trường & định dạng URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  console.log('1. KIỂM TRA BIẾN MÔI TRƯỜNG:');
  console.log(`- NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl ? 'có' : 'thiếu'}`);
  console.log(`- NEXT_PUBLIC_SUPABASE_ANON_KEY: ${anonKey ? 'có' : 'thiếu'}`);

  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      const isFormatValid =
        parsed.protocol === 'https:' && parsed.hostname.endsWith('.supabase.co');
      console.log(`- Tên miền: ${parsed.hostname}`);
      console.log(
        `- Định dạng URL (https://<id>.supabase.co): ${
          isFormatValid ? 'hợp lệ' : 'khác chuẩn mặc định (vui lòng kiểm tra lại)'
        }`
      );
    } catch {
      console.log('- Định dạng URL: không hợp lệ (URL malformed)');
    }
  }

  // b) Kiểm tra rò rỉ biến bảo mật trong tiền tố NEXT_PUBLIC_
  console.log('\n2. KIỂM TRA BẢO MẬT TIỀN TỐ NEXT_PUBLIC_:');
  const dangerousKeys = Object.keys(process.env).filter((k) => {
    const upper = k.toUpperCase();
    return (
      upper.startsWith('NEXT_PUBLIC_') &&
      (upper.includes('SERVICE') || upper.includes('SECRET'))
    );
  });

  if (dangerousKeys.length > 0) {
    console.log(
      `\x1b[31m[CẢNH BÁO BẢO MẬT NGUY HIỂM] Phát hiện biến công khai chứa từ khóa nhạy cảm: ${dangerousKeys.join(
        ', '
      )}. Hãy xóa ngay khỏi file .env để tránh rò rỉ quyền quản trị!\x1b[0m`
    );
  } else {
    console.log(
      '[BẢO MẬT OK] Không phát hiện biến NEXT_PUBLIC_ nào chứa SERVICE hoặc SECRET.'
    );
  }

  // e) Kiểm tra .env.local có đang bị git theo dõi không
  console.log('\n3. KIỂM TRA GIT INDEX:');
  try {
    const trackedFiles = execSync('git ls-files .env.local', {
      encoding: 'utf-8',
    }).trim();
    if (trackedFiles) {
      console.log(
        '\x1b[31m[CẢNH BÁO GIT NGUY HIỂM] File .env.local đang bị git theo dõi!\x1b[0m'
      );
      console.log('-> Hãy chạy lệnh sau trong terminal để gỡ khỏi git index:');
      console.log('   git rm --cached .env.local');
    } else {
      console.log('[GIT CHECK OK] File .env.local không bị git theo dõi (An toàn).');
    }
  } catch {
    console.log('[GIT CHECK] Không thể chạy git ls-files (bỏ qua).');
  }

  // c & d) Kiểm tra kết nối tới Supabase và các bảng
  console.log('\n4. KẾT NỐI VÀ KIỂM TRA BẢNG CƠ SỞ DỮ LIỆU:');
  if (!supabaseUrl || !anonKey) {
    console.log(
      '-> Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local. Bỏ qua bước kiểm tra kết nối API.'
    );
    return;
  }

  const supabase = createClient(supabaseUrl, anonKey);
  const tableConfigs = [
    { name: 'profiles', column: 'id' },
    { name: 'vocab_items', column: 'id' },
    { name: 'user_learned_words', column: 'user_id' },
    { name: 'chat_messages', column: 'id' },
  ];
  const tableStatus: Record<string, string> = {};
  let connectionOk = false;
  let isAuthOrNetworkError = false;

  for (const { name: table, column } of tableConfigs) {
    try {
      const { error } = await supabase.from(table).select(column).limit(1);
      if (!error) {
        tableStatus[table] = 'có';
        connectionOk = true;
      } else {
        const msg = String(error.message || '').toLowerCase();
        const code = error.code;

        // Chỉ coi bảng là "thiếu" khi lỗi trả về là bảng không tồn tại
        if (
          code === '42P01' ||
          code === 'PGRST204' ||
          code === 'PGRST200' ||
          msg.includes('relation') ||
          msg.includes('does not exist') ||
          msg.includes('could not find the table')
        ) {
          tableStatus[table] = 'thiếu';
          connectionOk = true; // Kết nối server thành công, bảng chưa tồn tại
        } else if (
          code === 'PGRST301' ||
          (error as any).status === 401 ||
          (error as any).status === 403 ||
          msg.includes('invalid api key') ||
          msg.includes('jwt') ||
          msg.includes('unauthorized') ||
          msg.includes('fetch failed')
        ) {
          tableStatus[table] = 'lỗi kết nối/xác thực';
          isAuthOrNetworkError = true;
        } else {
          // Các lỗi khác (quyền, RLS)
          tableStatus[table] = 'có (bị RLS chặn đọc, bình thường)';
          connectionOk = true;
        }
      }
    } catch {
      tableStatus[table] = 'lỗi kết nối';
      isAuthOrNetworkError = true;
    }
  }

  // Đánh giá tổng quan theo mục c
  if (isAuthOrNetworkError && !connectionOk) {
    console.log('[LỖI KẾT NỐI API]');
    console.log('-> Không thể xác thực với Supabase bằng Anon Key hoặc URL hiện tại.');
    console.log('-> Hướng kiểm tra:');
    console.log(
      '   1. Mở Supabase Dashboard -> chọn dự án -> Project Settings -> API.'
    );
    console.log(
      '   2. Đối chiếu Project URL với NEXT_PUBLIC_SUPABASE_URL.'
    );
    console.log(
      '   3. Đối chiếu Project API key (anon / public) với NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  } else if (
    tableStatus['vocab_items'] === 'có' ||
    tableStatus['vocab_items']?.startsWith('có')
  ) {
    console.log('Kết nối OK, bảng vocab_items tồn tại.');
  } else {
    console.log(
      'Kết nối OK nhưng chưa có bảng, hãy chạy supabase/schema.sql trong SQL Editor.'
    );
  }

  // Danh sách từng bảng theo mục d
  console.log('\nDanh sách bảng:');
  for (const { name: table } of tableConfigs) {
    console.log(`  - ${table}: ${tableStatus[table]}`);
  }

  console.log('\n========================================================');
  console.log('HOÀN TẤT KIỂM TRA');
  console.log('========================================================');
}

main().catch((err) => {
  console.error('Lỗi thực thi:', err.message);
  process.exit(1);
});
