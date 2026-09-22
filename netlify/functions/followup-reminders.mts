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

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Recife" });

  const prospectQuery = new URLSearchParams({
    select: "*",
    status: "in.(Orçamento enviado,Aguardando retorno,Em negociação)",
    proximo_contato: `lte.${today}`,
    or: `(ultimo_aviso_enviado.is.null,ultimo_aviso_enviado.lt.${today})`,
    order: "proximo_contato.asc"
  });

  const paymentQuery = new URLSearchParams({
    select: "*",
    status_pagamento: "eq.A receber",
    data_vencimento: `lt.${today}`,
    or: `(ultimo_aviso_pagamento.is.null,ultimo_aviso_pagamento.lt.${today})`,
    order: "data_vencimento.asc"
  });

  const fetchTable = async (table, query) => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?${query.toString()}`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
    });
    if (!response.ok) {
      console.error(`Supabase query failed for ${table}`, response.status, await response.text());
      return [];
    }
    return response.json();
  };

  const [clients, payments] = await Promise.all([
    fetchTable("clientes_potenciais", prospectQuery),
    fetchTable("vendas", paymentQuery)
  ]);

  if (!clients.length && !payments.length) return;

  const formatBRL = (value) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);

  const formatDate = (value) =>
    value ? new Date(value + "T12:00:00").toLocaleDateString("pt-BR") : "-";

  const clientRows = clients.map((client) => {
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

  const paymentRows = payments.map((sale) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #eee"><strong>${escapeHtml(sale.cliente)}</strong></td>
      <td style="padding:10px;border-bottom:1px solid #eee">${formatBRL(Number(sale.quantidade) * Number(sale.valor_unitario) - Number(sale.desconto || 0) + Number(sale.frete || 0))}</td>
      <td style="padding:10px;border-bottom:1px solid #eee">${formatDate(sale.data_vencimento)}</td>
      <td style="padding:10px;border-bottom:1px solid #eee">${escapeHtml(sale.produto)}</td>
    </tr>
  `).join("");

  const opportunityTotal = clients.reduce((sum, client) => sum + (Number(client.valor_orcamento) || 0), 0);
  const receivableTotal = payments.reduce((sum, sale) =>
    sum + (Number(sale.quantidade) * Number(sale.valor_unitario) - Number(sale.desconto || 0) + Number(sale.frete || 0)), 0);

  const clientSection = clients.length ? `
    <h3 style="margin:24px 0 10px">🔔 Clientes em potencial</h3>
    <p style="color:#667085">Há ${clients.length} follow-up(s) para fazer.</p>
    <div style="background:#f5f7fa;border-radius:12px;padding:12px;margin-bottom:12px">
      Oportunidades em acompanhamento: <strong>${formatBRL(opportunityTotal)}</strong>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="text-align:left;background:#f5f7fa">
        <th style="padding:10px">Cliente</th><th style="padding:10px">Orçamento</th><th style="padding:10px">Follow-up</th><th style="padding:10px">Situação</th><th style="padding:10px">Status</th>
      </tr></thead>
      <tbody>${clientRows}</tbody>
    </table>
  ` : "";

  const paymentSection = payments.length ? `
    <h3 style="margin:28px 0 10px">💰 Pagamentos atrasados</h3>
    <p style="color:#b42318"><strong>Hora de cobrar estes clientes.</strong></p>
    <div style="background:#fff0f0;border-radius:12px;padding:12px;margin-bottom:12px">
      Total em atraso: <strong>${formatBRL(receivableTotal)}</strong>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr style="text-align:left;background:#fff0f0">
        <th style="padding:10px">Cliente</th><th style="padding:10px">Valor</th><th style="padding:10px">Vencimento</th><th style="padding:10px">Venda</th>
      </tr></thead>
      <tbody>${paymentRows}</tbody>
    </table>
  ` : "";

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:auto;color:#18212b">
      <h2 style="margin:0 0 6px">SellaFlex Vendas — lembretes</h2>
      <p style="margin:0;color:#667085">Resumo automático do que precisa da sua atenção.</p>
      ${clientSection}
      ${paymentSection}
      <p style="margin-top:24px">
        <a href="https://sellaflex-vendas.netlify.app"
           style="display:inline-block;background:#1597d3;color:white;text-decoration:none;padding:12px 16px;border-radius:9px;font-weight:bold">
          Abrir SellaFlex Vendas
        </a>
      </p>
      <p style="font-size:12px;color:#667085">Aviso automático do sistema SellaFlex Vendas.</p>
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
      subject: clients.length && payments.length
        ? `🔔 SellaFlex: ${clients.length} follow-up(s) e ${payments.length} pagamento(s) atrasado(s)`
        : payments.length
          ? `💰 SellaFlex: ${payments.length} pagamento(s) atrasado(s)`
          : `🔔 SellaFlex: ${clients.length} follow-up(s)`,
      htmlContent: html
    })
  });

  if (!mailResponse.ok) {
    console.error("Brevo send failed", mailResponse.status, await mailResponse.text());
    return;
  }

  for (const client of clients) {
    await fetch(`${supabaseUrl}/rest/v1/clientes_potenciais?id=eq.${client.id}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ ultimo_aviso_enviado: today })
    });
  }

  for (const sale of payments) {
    await fetch(`${supabaseUrl}/rest/v1/vendas?id=eq.${sale.id}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ ultimo_aviso_pagamento: today })
    });
  }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

export const config = { schedule: "0 12 * * *" };
