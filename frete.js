// Função da Netlify: consulta o frete dos Correios (PAC e SEDEX) pelo Melhor Envio.
// O token fica nas variáveis de ambiente da Netlify e nunca aparece no site.
//
// Variáveis necessárias (Netlify > Site configuration > Environment variables):
//   ME_TOKEN     token de acesso do Melhor Envio
//   ORIGEM_CEP   CEP de onde você envia os pedidos (só números ou com hífen)
//   ME_CONTATO   seu e-mail de contato (o Melhor Envio exige no cabeçalho User-Agent)
//   ME_AMBIENTE  opcional: "sandbox" para testes. Sem isso, usa produção.

const json = (status, corpo) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  body: JSON.stringify(corpo),
});

const num = (v, min, max, padrao) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : padrao;
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { erro: "Use POST." });

  const token = process.env.ME_TOKEN;
  const origem = String(process.env.ORIGEM_CEP || "").replace(/\D/g, "");
  const contato = process.env.ME_CONTATO;
  if (!token || origem.length !== 8 || !contato) {
    return json(503, { erro: "Frete não configurado no servidor." });
  }

  let corpo;
  try { corpo = JSON.parse(event.body || "{}"); } catch { return json(400, { erro: "Pedido inválido." }); }

  const cep = String(corpo.cep || "").replace(/\D/g, "");
  if (cep.length !== 8) return json(400, { erro: "CEP inválido." });

  const itens = Array.isArray(corpo.itens) ? corpo.itens.slice(0, 20) : [];
  if (!itens.length) return json(400, { erro: "Sacola vazia." });

  const products = itens.map((i, n) => ({
    id: String(i.id || n + 1).slice(0, 20),
    width: num(i.largura, 1, 100, 11),
    height: num(i.altura, 1, 100, 4),
    length: num(i.comprimento, 1, 100, 16),
    weight: num(i.peso, 0.01, 30, 0.1),
    insurance_value: Math.round(num(i.valor, 0, 10000, 0) * 100) / 100,
    quantity: Math.round(num(i.qtd, 1, 50, 1)),
  }));

  const base = process.env.ME_AMBIENTE === "sandbox"
    ? "https://sandbox.melhorenvio.com.br"
    : "https://melhorenvio.com.br";

  let resposta;
  try {
    resposta = await fetch(`${base}/api/v2/me/shipment/calculate`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": `O Universo Feminino (${contato})`,
      },
      body: JSON.stringify({
        from: { postal_code: origem },
        to: { postal_code: cep },
        products,
        options: { receipt: false, own_hand: false },
        services: "1,2", // 1 = PAC, 2 = SEDEX (Correios)
      }),
    });
  } catch {
    return json(502, { erro: "Não foi possível falar com o Melhor Envio." });
  }

  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !Array.isArray(dados)) {
    return json(502, { erro: "O Melhor Envio não retornou o frete." });
  }

  // custom_price e custom_delivery_time já trazem os descontos da sua conta
  const opcoes = dados
    .filter((s) => !s.error && /correios/i.test((s.company && s.company.name) || ""))
    .map((s) => ({
      id: s.id,
      nome: s.name,
      valor: Number(s.custom_price ?? s.price),
      prazo: Number(s.custom_delivery_time ?? s.delivery_time),
    }))
    .filter((o) => Number.isFinite(o.valor) && o.valor > 0)
    .sort((a, b) => a.valor - b.valor);

  return json(200, { opcoes });
};
