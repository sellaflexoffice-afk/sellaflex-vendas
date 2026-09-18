const COOKIE_NAME = "sellaflex_access";
const SESSION_DAYS = 7;

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(request) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp("(^|;\\s*)" + COOKIE_NAME + "=([^;]+)"));
  return match ? match[2] : null;
}

function loginPage(error) {
  return "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>SellaFlex Vendas — Acesso</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f7fa;font-family:Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#18212b;padding:20px}.card{width:min(420px,100%);background:#fff;border:1px solid #e4e9ef;border-radius:18px;padding:28px;box-shadow:0 12px 35px rgba(24,33,43,.08)}.brand{font-size:28px;font-weight:900;margin-bottom:6px}.brand span{color:#1597d3}.sub{color:#667085;margin:0 0 22px}label{font-size:13px;font-weight:700;display:block;margin-bottom:6px}input{width:100%;padding:13px;border:1px solid #ccd5df;border-radius:10px;font:inherit}button{width:100%;margin-top:14px;border:0;border-radius:10px;padding:13px;background:#1597d3;color:#fff;font-weight:800;font-size:15px;cursor:pointer}.error{background:#fff0f0;color:#b42318;padding:10px;border-radius:10px;margin-bottom:14px;font-size:14px}</style></head><body><div class=\"card\"><div class=\"brand\">Sella<span>Flex</span></div><h2 style=\"margin:0 0 6px\">Acesso ao sistema</h2><p class=\"sub\">Digite a senha para entrar no SellaFlex Vendas.</p>" +
    (error ? "<div class=\"error\">" + error + "</div>" : "") +
    "<form method=\"post\" action=\"/__sellaflex-login\"><label for=\"password\">Senha</label><input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required autofocus><button type=\"submit\">Entrar</button></form></div></body></html>";
}

export default async (request, context) => {
  const configuredPassword = Netlify.env.get("SELLAFLEX_ACCESS_PASSWORD");

  if (!configuredPassword) {
    return new Response("Proteção não configurada. Adicione SELLAFLEX_ACCESS_PASSWORD nas variáveis de ambiente do Netlify.", {
      status: 503,
      headers: {"content-type": "text/plain; charset=utf-8", "cache-control": "no-store"}
    });
  }

  const url = new URL(request.url);

  if (url.pathname === "/__sellaflex-login" && request.method === "POST") {
    const form = await request.formData();
    const password = String(form.get("password") || "");
    const expected = await sha256(configuredPassword + "::sellaflex-session-v1");
    const supplied = await sha256(password + "::sellaflex-session-v1");

    if (supplied !== expected) {
      return new Response(loginPage("Senha incorreta."), {
        status: 401,
        headers: {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"}
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        "location": "/",
        "cache-control": "no-store",
        "set-cookie": COOKIE_NAME + "=" + expected + "; Path=/; Max-Age=" + (SESSION_DAYS * 86400) + "; HttpOnly; Secure; SameSite=Strict"
      }
    });
  }

  const expectedCookie = await sha256(configuredPassword + "::sellaflex-session-v1");
  if (cookieValue(request) === expectedCookie) {
    return context.next();
  }

  return new Response(loginPage(), {
    status: 200,
    headers: {"content-type": "text/html; charset=utf-8", "cache-control": "no-store"}
  });
};

export const config = {
  path: "/*"
};
