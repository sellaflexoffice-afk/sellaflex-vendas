export default async () => {
  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const supabaseKey = Netlify.env.get("SUPABASE_PUBLISHABLE_KEY");
  const brevoKey = Netlify.env.get("BREVO_API_KEY");
  const recipient = Netlify.env.get("SELLAFLEX_REMINDER_EMAIL");
  const sender = Netlify.env.get("BREVO_SENDER_EMAIL");

  if (!supabaseUrl || !supabaseKey || !brevoKey || !recipient || !sender) {
    console.error("Missing reminder environment variables");
    return;
  }

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Recife"
  });

  const query = new URLSearchParams({
    select: "*",
    status: "in.(Orçamento enviado,Aguardando retorno,Em negociação)",
    proximo_contato: `lte.${today}`,
    or: `(ultimo_aviso_enviado.is.null,ultimo_aviso_enviado.lt.${today})`,
    order: "proximo_contato.asc"
  });

  const response = await fetch(
    `${supabaseUrl}/rest/v1/clientes_potenciais?${query.toString()}`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    }
  );

  if (!response.ok) {
    console.error("Supabase query failed", response.status, await response.text());
    return;
  }

  const clients = await response.json();
  if (!clients.length) return;

  const formatBRL = (value) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(Number(value) || 0);

  const formatDate = (value) =>
    value
      ? new Date(value + "T12:00:00").toLocaleDateString("pt-BR")
      : "Sem data";

  const rows = clients.map((client) => {
    const overdue = client.proximo_contato < today;
    return `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee"><strong>${escapeHtml(client.cliente)}</strong></td>
        <td style="padding:10px;border-bottom:1px solid #eee">${formatBRL(client.valor_orcamento)}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${formatDate(client.proximo_contato)}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${overdue ? "Atrasado" : "Hoje"}</td>
        <td style="padding:10px;border-bottom:1px solid #eee">${escapeHtml(client.status)}</td>
      </tr>
    `;
  }).join("");

  const total = clients.reduce(
    (sum, client) => sum + (Number(client.valor_orcamento) || 0),
    0
  );

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#18212b">
      <div style="padding:20px 0">
        <h2 style="margin:0 0 6px">🔔 Follow-ups da SellaFlex</h2>
        <p style="margin:0;color:#667085">Há ${clients.length} cliente(s) que precisam de acompanhamento.</p>
      </div>
      <div style="background:#f5f7fa;border-radius:12px;padding:14px;margin-bottom:18px">
        <strong>Oportunidades em acompanhamento:</strong> ${formatBRL(total)}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="text-align:left;background:#f5f7fa">
            <th style="padding:10px">Cliente</th>
            <th style="padding:10px">Orçamento</th>
            <th style="padding:10px">Follow-up</th>
            <th style="padding:10px">Situação</th>
            <th style="padding:10px">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:22px">
        <a href="https://sellaflex-vendas.netlify.app"
           style="display:inline-block;background:#1597d3;color:white;text-decoration:none;padding:12px 16px;border-radius:9px;font-weight:bold">
          Abrir SellaFlex Vendas
        </a>
      </p>
      <p style="font-size:12px;color:#667085;margin-top:24px">
        Este aviso é automático e foi enviado pelo sistema SellaFlex Vendas.
      </p>
    </div>
  `;

  const mailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": brevoKey,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "SellaFlex Vendas", email: sender },
      to: [{ email: recipient, name: "SellaFlex" }],
      subject: clients.length === 1
        ? `🔔 Follow-up: ${clients[0].cliente}`
        : `🔔 ${clients.length} follow-ups da SellaFlex`,
      htmlContent: html,
      textContent: clients
        .map((client) => `${client.cliente} — ${formatBRL(client.valor_orcamento)} — follow-up ${formatDate(client.proximo_contato)}`)
        .join("\n")
    })
  });

  if (!mailResponse.ok) {
    console.error("Brevo send failed", mailResponse.status, await mailResponse.text());
    return;
  }

  for (const client of clients) {
    const update = await fetch(
      `${supabaseUrl}/rest/v1/clientes_potenciais?id=eq.${client.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          ultimo_aviso_enviado: today,
          atualizado_em: new Date().toISOString()
        })
      }
    );

    if (!update.ok) {
      console.error("Failed to mark reminder sent", client.id, update.status, await update.text());
    }
  }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

export const config = {
  schedule: "0 12 * * *"
};
