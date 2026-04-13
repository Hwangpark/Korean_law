import nodemailer from "nodemailer";

export interface EmailServiceConfig {
  user: string;
  appPassword: string;
  enabled: boolean;
  baseUrl: string;
}

export interface EmailService {
  sendVerificationCode(to: string, code: string): Promise<void>;
}

export function createEmailService(config: EmailServiceConfig): EmailService {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.user,
      pass: config.appPassword,
    },
  });

  async function sendVerificationCode(to: string, code: string): Promise<void> {
    if (!config.enabled) {
      console.warn(`[email] GMAIL_APP_PASSWORD not set — verification code: ${code}`);
      return;
    }

    await transporter.sendMail({
      from: `KoreanLaw <${config.user}>`,
      to,
      subject: `[KoreanLaw] 이메일 인증 코드: ${code}`,
      html: `
        <div style="font-family:-apple-system,'Malgun Gothic',sans-serif;max-width:480px;margin:40px auto;padding:32px;background:#111;border-radius:16px;color:#e8e8e8;">
          <div style="font-size:1.8rem;font-weight:900;color:#03c75a;margin-bottom:24px;">⚖ KoreanLaw</div>
          <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:12px;">이메일 인증 코드</h2>
          <p style="color:#aaa;line-height:1.6;margin-bottom:24px;">
            아래 6자리 코드를 입력해 이메일 인증을 완료하세요.<br/>
            코드는 <strong style="color:#e8e8e8;">10분</strong> 동안 유효합니다.
          </p>
          <div style="display:inline-block;padding:20px 40px;background:#1e1e1e;border:2px solid #03c75a;border-radius:12px;font-size:2.2rem;font-weight:900;letter-spacing:0.3em;color:#03c75a;margin-bottom:24px;">
            ${code}
          </div>
          <p style="color:#555;font-size:0.85rem;">
            본인이 요청하지 않은 경우 이 이메일을 무시하세요.
          </p>
        </div>
      `,
    });
  }

  return { sendVerificationCode };
}
