"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/PageHeader";

/* ─── Types ─────────────────────────────────────────────────────── */

interface Merchant {
  id: number;
  label: string;
  channel_id: string;
  platform: "slack" | "telegram";
  business_ids: number[];
  is_active: boolean;
  notes: string | null;
  partner_bots: { id: number; username: string; label: string }[];
}

interface Person {
  id: string;
  type: "tonder_team" | "merchant_contact";
  name: string;
  role: string;
  company: string;
  slack_user_id: string | null;
  telegram_user_id: string | null;
  email: string;
  domain: string;
  escalation_notes: string;
}

/* ─── Static data (sections + checklist + special notes) ────────── */

const SECTIONS = [
  { id: "bienvenida", num: 1, title: "Bienvenida" },
  { id: "productos", num: 2, title: "Productos de Tonder" },
  { id: "metodos", num: 3, title: "Métodos de Pago" },
  { id: "provider-masking", num: 4, title: "Provider Masking", critical: true },
  { id: "merchants", num: 5, title: "Nuestros Merchants" },
  { id: "canales", num: 6, title: "Canales de Comunicación" },
  { id: "casos-comunes", num: 7, title: "Problemas Comunes" },
  { id: "escalacion", num: 8, title: "Escalación" },
  { id: "pascal-dia-a-dia", num: 9, title: "Usando Pascal" },
  { id: "glosario", num: 10, title: "Glosario" },
  { id: "decline-codes", num: 11, title: "Decline Codes" },
  { id: "recursos", num: 12, title: "Recursos y Dashboards" },
] as const;

const CHECKLIST: { id: string; label: string }[] = [
  { id: "read-manual", label: "Leer este manual completo" },
  { id: "join-slack", label: "Unirme a los canales de Slack de cada merchant" },
  { id: "join-telegram", label: "Pedir al equipo agregarme a los grupos de Telegram" },
  { id: "meet-team", label: "Conocer a Roberto, Sandy y Geraldine (1:1 de 15 min)" },
  { id: "pascal-10-questions", label: "Hacerle 10 preguntas de prueba a Pascal" },
  { id: "read-5-tickets", label: "Leer 5 tickets cerrados de Pascal en Linear" },
  { id: "review-dashboard", label: "Revisar mis merchants asignados en este dashboard" },
  { id: "train-pascal", label: "Entrenar a Pascal con 1 entrada nueva al KB" },
  { id: "first-ticket", label: "Resolver mi primer ticket end-to-end con guía del equipo" },
];

const LS_KEY = "pascal-cs-onboarding-checklist-v1";

// Extra context not stored in the DB — quirky merchant-specific notes
// keyed by Slack channel_id or Telegram chat_id.
const MERCHANT_SPECIAL_NOTES: Record<string, string> = {
  C0A1Z7V3S1E:
    "Problemas frecuentes de account creation → escalar a Geraldine.",
  C0A1WABSC4V:
    "Dos business IDs (530 y 533). Pascal busca en ambos automáticamente.",
  "-1002589749469":
    "Usa bot de ticketing propio (bcgame_ticket_bot). El ID de referencia llega en customer_order_id, NO en txid. Si txid está vacío, Pascal lo consume silenciosamente.",
};

const DOMAIN_COLORS: Record<string, string> = {
  payments: "bg-emerald-100 text-emerald-700",
  integrations: "bg-violet-100 text-violet-700",
  finops: "bg-amber-100 text-amber-700",
  mid: "bg-rose-100 text-rose-700",
  acquirer: "bg-rose-100 text-rose-700",
  infra: "bg-purple-100 text-purple-700",
  support: "bg-cyan-100 text-cyan-700",
  engineering: "bg-cyan-100 text-cyan-700",
  product: "bg-violet-100 text-violet-700",
  sales: "bg-orange-100 text-orange-700",
};

/* ─── Checklist hook ────────────────────────────────────────────── */

function useChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) setDone(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { done, toggle };
}

/* ─── Page ──────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [merchantsError, setMerchantsError] = useState(false);
  const [team, setTeam] = useState<Person[] | null>(null);
  const [teamError, setTeamError] = useState(false);

  const { done, toggle } = useChecklist();

  useEffect(() => {
    fetch("/api/merchants")
      .then((r) => r.json())
      .then((d) =>
        setMerchants(((d.merchants as Merchant[]) ?? []).filter((m) => m.is_active))
      )
      .catch(() => setMerchantsError(true));

    fetch("/api/people?type=tonder_team")
      .then((r) => r.json())
      .then((d) => setTeam((d.people as Person[]) ?? []))
      .catch(() => setTeamError(true));
  }, []);

  const completedCount = useMemo(
    () => CHECKLIST.filter((c) => done[c.id]).length,
    [done]
  );
  const progressPct = Math.round((completedCount / CHECKLIST.length) * 100);

  return (
    <>
      <PageHeader
        title="Onboarding"
        subtitle="Tu manual de referencia para Customer Support"
        right={
          <span className="text-[11px] text-gray-400 px-2 py-1 rounded-full border border-gray-200">
            Última actualización · Mayo 2026
          </span>
        }
      />

      <div className="flex gap-6">
        {/* Sticky TOC — left rail */}
        <aside className="hidden lg:block sticky top-[76px] self-start w-[220px] shrink-0">
          <nav className="t-card !p-3 text-[13px] space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={`flex items-baseline gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50 transition-colors ${
                  "critical" in s && s.critical
                    ? "text-red-700 font-medium"
                    : "text-gray-700"
                }`}
              >
                <span className="text-gray-400 text-[11px] w-4 shrink-0">
                  {s.num}
                </span>
                <span className="truncate">{s.title}</span>
              </a>
            ))}
            <div className="h-px bg-gray-100 my-2" />
            <a
              href="#checklist"
              className="flex items-baseline gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50 text-violet-700 font-medium"
            >
              <span className="w-4 shrink-0">✓</span>
              <span>Checklist</span>
            </a>
          </nav>
          <p className="text-[10px] text-gray-400 mt-3 px-2">
            Audiencia: representantes de CS · Pascal AI Support
          </p>
        </aside>

        {/* Main content column */}
        <div className="flex-1 min-w-0 space-y-8">
          {/* Hero / Welcome banner */}
          <div
            className="rounded-xl p-6 fade-in d1"
            style={{
              background: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
              borderColor: "#ddd6fe",
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            <p className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-2">
              Bienvenida al equipo
            </p>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Este es tu manual de referencia.
            </h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              Pascal te ayuda con lo rutinario; tú eres responsable de los casos
              complejos, los reembolsos manuales, la relación con cada merchant,
              y todo lo que requiere juicio. Léelo entero, marca el checklist
              conforme avances, y consulta esta página cuando dudes.
            </p>
          </div>

          {/* §1 Bienvenida */}
          <Section id="bienvenida" num={1} title="Bienvenida">
            <div className="grid md:grid-cols-2 gap-4">
              <Card title="¿Qué es Tonder?">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Plataforma de <strong>orquestación de pagos</strong> con sede
                  en México. Conectamos merchants con múltiples proveedores
                  (acquirers, gateways, bancos) a través de una sola integración.
                  El merchant integra Tonder una vez y nosotros enrutamos cada
                  transacción al proveedor óptimo.
                </p>
                <ul className="mt-3 text-sm text-gray-700 space-y-1.5">
                  <li>• Procesamos tarjetas (crédito y débito)</li>
                  <li>• Procesamos SPEI (transferencias bancarias MX)</li>
                  <li>• Procesamos cash vouchers, OXXO Pay, MercadoPago, APMs</li>
                  <li>• Manejamos withdrawals/payouts</li>
                  <li>• Ofrecemos un dashboard para los merchants</li>
                </ul>
              </Card>

              <Card title="¿Qué es Pascal?">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Nuestro <strong>asistente de IA</strong> integrado en Slack y
                  Telegram. Le responde directamente a los merchants en sus
                  canales asignados.
                </p>
                <ul className="mt-3 text-sm text-gray-700 space-y-1.5">
                  <li>• Consulta el estado de transacciones, depósitos, withdrawals</li>
                  <li>• Busca pagos por ID, txid, payment_id, order_id, etc.</li>
                  <li>• Genera comprobantes de reembolso en PDF</li>
                  <li>• Explica conceptos de integración técnica</li>
                  <li>• Crea tickets de Linear automáticamente cuando escala</li>
                </ul>
                <p className="text-xs text-gray-500 mt-3 italic">
                  Pascal <strong>NO reemplaza al equipo de CS.</strong> Maneja lo
                  rutinario y rápido — tú llevas lo complejo.
                </p>
              </Card>
            </div>

            <Card title="Tu rol como CS" className="mt-4">
              <ul className="text-sm text-gray-700 space-y-1.5">
                <li>• <strong>Monitorear los canales</strong> de Slack y Telegram de cada merchant</li>
                <li>• <strong>Responder tickets</strong> que Pascal escala (se crean en Linear automáticamente)</li>
                <li>• <strong>Investigar problemas</strong> que Pascal no pudo resolver</li>
                <li>• <strong>Coordinar con FinOps, Integrations y MID</strong> cuando se requiere</li>
                <li>• <strong>Mantener la relación</strong> con cada merchant — entender sus quirks, volumen, problemas recurrentes</li>
                <li>• <strong>Aprender de cada caso</strong> y entrenar a Pascal con <code className="text-violet-700 font-mono text-xs">@Pascal learn:</code></li>
              </ul>
            </Card>
          </Section>

          {/* §2 Productos */}
          <Section id="productos" num={2} title="Productos de Tonder">
            <div className="grid md:grid-cols-2 gap-4">
              <Card title="Procesamiento de Pagos">
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  Tonder es el <strong>layer de orquestación</strong>. El
                  merchant envía una transacción a nuestra API y nosotros
                  decidimos a qué proveedor enviarla.
                </p>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• Mejor acceptance rate (reintento entre proveedores)</li>
                  <li>• Redundancia si un proveedor cae</li>
                  <li>• Una sola integración</li>
                  <li>• Reporting unificado</li>
                </ul>
              </Card>
              <Card title="Withdrawals / Payouts">
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  Algunos merchants necesitan <strong>enviar dinero</strong> a sus
                  usuarios (devolver depósitos, pagar premios). Tonder lo maneja vía:
                </p>
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• <strong>SPEI out</strong> — transferencia bancaria al CLABE</li>
                  <li>• <strong>Card refunds</strong> — devolución a la tarjeta original (solo tarjeta)</li>
                </ul>
              </Card>
              <Card title="Dashboard">
                <p className="text-sm text-gray-700 leading-relaxed">
                  Los merchants pueden ver sus transacciones en tiempo real,
                  acceptance rates por método, top decline reasons,
                  conciliaciones y reportes.
                </p>
              </Card>
              <Card title="APIs y SDKs">
                <ul className="text-sm text-gray-700 space-y-1">
                  <li>• <strong>REST API</strong> — para servidor a servidor</li>
                  <li>• <strong>SDKs de JavaScript</strong> — checkout web</li>
                  <li>• <strong>Webhooks</strong> — notificaciones de cambios de estado</li>
                </ul>
                <p className="text-xs text-gray-500 mt-3 italic">
                  Como CS no necesitas dominar los SDKs, pero sí saber que
                  existen. Para integraciones complejas, escala a Sandy.
                </p>
              </Card>
            </div>
          </Section>

          {/* §3 Métodos de Pago */}
          <Section id="metodos" num={3} title="Métodos de Pago">
            <p className="text-sm text-gray-600 mb-3">
              Los nombres en la columna <strong>&ldquo;Cómo lo llamas al merchant&rdquo;</strong> son
              los únicos que debes usar en comunicación externa. Los nombres
              internos NUNCA se mencionan al merchant (ver §4).
            </p>
            <div className="t-card t-card-flush overflow-hidden">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Método (externo)</th>
                    <th>Tipo</th>
                    <th>Notas</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>Cards</strong></td>
                    <td>Tarjeta crédito/débito</td>
                    <td className="text-gray-600">Soporta reembolsos. Visa, MC, Amex.</td>
                  </tr>
                  <tr>
                    <td><strong>SPEI</strong></td>
                    <td>Transferencia bancaria MX</td>
                    <td className="text-red-700">⚠️ NO soporta reembolsos.</td>
                  </tr>
                  <tr>
                    <td><strong>Cash Vouchers</strong></td>
                    <td>Voucher de efectivo</td>
                    <td className="text-gray-600">Pago en tiendas físicas</td>
                  </tr>
                  <tr>
                    <td><strong>OXXOPay</strong></td>
                    <td>Voucher OXXO</td>
                    <td className="text-gray-600">Pago en tiendas OXXO</td>
                  </tr>
                  <tr>
                    <td><strong>MercadoPago</strong></td>
                    <td>Wallet</td>
                    <td className="text-gray-600">Pago vía MercadoPago</td>
                  </tr>
                  <tr>
                    <td><strong>APMs</strong></td>
                    <td>Alternative Payment Methods</td>
                    <td className="text-gray-600">Categoría general (wallets / locales)</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Callout tone="danger" title="SPEI NO se puede reembolsar">
              Si un usuario pagó con SPEI y necesita su dinero de vuelta, el
              merchant tiene que <strong>enviarle un withdrawal manualmente</strong> — no es
              un &ldquo;refund&rdquo; técnico. Solo las transacciones con <strong>tarjeta</strong> soportan
              refund nativo.
            </Callout>

            <Callout tone="danger" title="Fees, revenue, rates, reserves y settlements son CONFIDENCIALES">
              Nunca compartas estos datos con el merchant. Si te preguntan,
              escala a <strong>Roberto (FinOps)</strong>.
            </Callout>
          </Section>

          {/* §4 Provider Masking — CRITICAL */}
          <Section
            id="provider-masking"
            num={4}
            title="🚨 Provider Masking"
            subtitle="La regla más importante del manual. Léela dos veces."
          >
            <p className="text-sm text-gray-700 leading-relaxed">
              Tonder trabaja con varios proveedores de pago detrás de bambalinas.
              Los merchants <strong>NUNCA deben saber qué proveedor procesa cada
              tipo de pago.</strong> Eso es nuestro IP comercial.
            </p>

            <Card title="Tabla de equivalencias" className="mt-4">
              <div className="overflow-x-auto -mx-1">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Proveedor interno (NUNCA mencionar)</th>
                      <th>Cómo lo llamas al merchant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["kushki", "Cards"],
                      ["unlimit", "Cards"],
                      ["guardian", "Cards"],
                      ["tonder (como acquirer)", "Cards"],
                      ["bitso", "SPEI"],
                      ["stp", "SPEI"],
                      ["safetypay", "Cash Vouchers"],
                      ["oxxopay", "OXXOPay"],
                      ["mercadopago", "MercadoPago"],
                    ].map(([internal, external]) => (
                      <tr key={internal}>
                        <td>
                          <code className="font-mono text-[12px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                            {internal}
                          </code>
                        </td>
                        <td><strong>{external}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Palabras prohibidas en comunicación externa" className="mt-4">
              <p className="text-sm text-gray-600 mb-3">
                Estas palabras <strong>JAMÁS</strong> deben aparecer en un mensaje
                a un merchant, en un ticket de Linear visible al merchant, ni en
                ningún comprobante:
              </p>
              <div className="flex flex-wrap gap-2">
                {["kushki", "unlimit", "guardian", "bitso", "stp", "safetypay"].map((w) => (
                  <span key={w} className="t-badge t-badge-red font-mono">
                    {w}
                  </span>
                ))}
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Card title="¿Por qué importa?">
                <ul className="text-sm text-gray-700 space-y-2">
                  <li>
                    <strong>Competitivo:</strong> si el merchant sabe quién es el
                    acquirer real, puede integrarse directo y dejarnos fuera.
                  </li>
                  <li>
                    <strong>Legal:</strong> algunos contratos con proveedores nos
                    prohíben revelar la relación.
                  </li>
                  <li>
                    <strong>Comercial:</strong> el merchant compra &ldquo;Cards de
                    Tonder&rdquo;, no &ldquo;Cards de Kushki vía Tonder&rdquo;.
                  </li>
                </ul>
              </Card>
              <div
                className="rounded-xl p-5"
                style={{
                  background: "rgba(236,253,245,0.6)",
                  borderColor: "#a7f3d0",
                  borderWidth: 1,
                  borderStyle: "solid",
                }}
              >
                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider mb-2">
                  Pascal te ayuda
                </p>
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  Pascal tiene tres capas de protección contra leaks:
                </p>
                <ol className="text-sm text-gray-700 space-y-1 list-decimal pl-5">
                  <li>System prompt que le dice qué decir y qué no</li>
                  <li>Sanitización del output de tools antes de mostrar datos</li>
                  <li>Audit post-respuesta — escanea cada respuesta antes de enviar</li>
                </ol>
                <p className="text-xs text-gray-600 mt-3 italic">
                  Aún así, revisa siempre los mensajes que envías manualmente.
                  Si dudas: <code className="font-mono text-violet-700">@Pascal ¿cómo se llama externamente X?</code>
                </p>
              </div>
            </div>
          </Section>

          {/* §5 Merchants — LIVE */}
          <Section
            id="merchants"
            num={5}
            title="Nuestros Merchants"
            subtitle="Datos en vivo desde la base de datos"
          >
            {merchantsError ? (
              <Callout tone="warn" title="Live merchants data unavailable">
                No pudimos cargar la lista de merchants desde <code>/api/merchants</code>.
                Avisa al equipo Pascal — esta página debe quedar como single source
                of truth, no como snapshot estático.
              </Callout>
            ) : merchants === null ? (
              <SkeletonRows />
            ) : merchants.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No hay merchants activos.</p>
            ) : (
              <div className="t-card t-card-flush overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Merchant</th>
                        <th>Plataforma</th>
                        <th>Canal</th>
                        <th>Business IDs</th>
                        <th>Bots</th>
                        <th>Notas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merchants.map((m) => (
                        <tr key={m.id}>
                          <td className="font-medium text-gray-900">{m.label}</td>
                          <td>
                            <span className={`t-badge ${m.platform === "slack" ? "t-badge-blue" : "t-badge-violet"}`}>
                              {m.platform}
                            </span>
                          </td>
                          <td>
                            <code className="font-mono text-[11px] text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                              {m.channel_id}
                            </code>
                          </td>
                          <td className="text-[12px] text-gray-600">
                            {(m.business_ids ?? []).join(", ") || "—"}
                          </td>
                          <td className="text-[12px] text-gray-500">
                            {m.partner_bots.length > 0
                              ? `${m.partner_bots.length} bot${m.partner_bots.length === 1 ? "" : "s"}`
                              : "—"}
                          </td>
                          <td className="text-[12px] text-gray-600 max-w-[280px]">
                            <span className="line-clamp-2">{m.notes || "—"}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Special notes — quirky per-merchant context not in DB */}
            {merchants && merchants.some((m) => MERCHANT_SPECIAL_NOTES[m.channel_id]) && (
              <div className="mt-4 space-y-3">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
                  Notas especiales por merchant
                </p>
                {merchants
                  .filter((m) => MERCHANT_SPECIAL_NOTES[m.channel_id])
                  .map((m) => (
                    <div
                      key={m.id}
                      className="t-card !p-3 border-l-4"
                      style={{ borderLeftColor: "#f59e0b" }}
                    >
                      <p className="text-sm font-semibold text-gray-900 mb-1">{m.label}</p>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {MERCHANT_SPECIAL_NOTES[m.channel_id]}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </Section>

          {/* §6 Canales */}
          <Section id="canales" num={6} title="Canales de Comunicación">
            <Card title="Slack vs Telegram">
              <p className="text-sm text-gray-700 mb-3">
                Pascal opera en ambos. Funcionalmente son iguales, pero hay
                diferencias:
              </p>
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Slack</th>
                      <th>Telegram</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">Modo de conexión</td>
                      <td>Socket Mode</td>
                      <td>Polling (con singleton lock en Postgres)</td>
                    </tr>
                    <tr>
                      <td className="font-medium">ID de usuarios</td>
                      <td>Slack User ID (<code className="font-mono text-[11px]">U091...</code>)</td>
                      <td>Telegram User ID (numérico)</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Mensajes editados</td>
                      <td>Pascal los lee</td>
                      <td>Pascal NO los procesa</td>
                    </tr>
                    <tr>
                      <td className="font-medium">Threading</td>
                      <td>Sí, robusto</td>
                      <td>Limitado</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Ambient Mode (cómo Pascal decide responder)" className="mt-4">
              <p className="text-sm text-gray-700 mb-3">
                Pascal no responde a TODO. Tiene un sistema que decide cuándo
                intervenir:
              </p>
              <ol className="text-sm text-gray-700 space-y-2 list-decimal pl-5">
                <li><strong>Mensaje en canal mapeado de merchant</strong> → Pascal responde siempre (con cooldown de 30s)</li>
                <li><strong>Mensaje de un bot de ticketing con <code className="font-mono text-xs">txid:</code></strong> → Pascal busca y responde</li>
                <li><strong>Mensaje de un bot con <code className="font-mono text-xs">txid:</code> vacío</strong> → Pascal consume el mensaje sin responder</li>
                <li><strong>Mensaje en canal de training</strong> → Pascal corre triage con Haiku y decide</li>
                <li><strong>Mensaje de un miembro del equipo Tonder</strong> → Pascal lo ignora (a menos que lo tagueen)</li>
                <li><strong>Mensaje trivial (&lt; 10 caracteres)</strong> → Pascal lo ignora</li>
              </ol>
            </Card>

            <Card title="Cómo identificar a qué merchant pertenece un mensaje" className="mt-4">
              <ul className="text-sm text-gray-700 space-y-1.5">
                <li>• En <strong>Slack</strong>, el <code className="font-mono text-xs">channel_id</code> (empieza con <code className="font-mono text-xs">C0...</code>) te dice el merchant. Ver §5.</li>
                <li>• En <strong>Telegram</strong>, el <code className="font-mono text-xs">chat_id</code> (negativo, empieza con <code className="font-mono text-xs">-100...</code>) te dice el merchant.</li>
                <li>• Si tienes dudas: <code className="font-mono text-xs text-violet-700">@Pascal ¿de qué merchant es este canal?</code></li>
              </ul>
            </Card>
          </Section>

          {/* §7 Casos Comunes */}
          <Section id="casos-comunes" num={7} title="Problemas Comunes y Cómo Resolverlos">
            <div className="space-y-4">
              <CaseCard
                title="Caso 1 · Mi depósito no aparece"
                escalateTo="FinOps (Roberto) si el depósito definitivamente no existe"
              >
                <ol className="text-sm text-gray-700 space-y-1.5 list-decimal pl-5">
                  <li>Pídele al merchant el ID de referencia (puede llamarse <code className="font-mono text-xs">txid</code>, <code className="font-mono text-xs">reference</code>, <code className="font-mono text-xs">order_id</code>, etc.)</li>
                  <li><code className="font-mono text-xs text-violet-700">@Pascal lookup_by_id &lt;ID&gt;</code> — busca en todos los sistemas</li>
                  <li>Si Pascal no lo encuentra: verifica que el ID esté bien escrito; si es BC Game, recuerda <code className="font-mono text-xs">customer_order_id</code></li>
                  <li>Si definitivamente no existe, escala a <strong>Roberto</strong> para confirmar con el banco</li>
                </ol>
              </CaseCard>

              <CaseCard title="Caso 2 · Solicito un reembolso" escalateTo="depende del método">
                <p className="text-sm text-gray-700 mb-2">Primero confirma el método de pago original:</p>
                <ul className="text-sm text-gray-700 space-y-1.5">
                  <li>✅ <strong>Tarjeta:</strong> genera refund. Pascal puede crear el PDF con <code className="font-mono text-xs">generate_refund_receipt</code></li>
                  <li>❌ <strong>SPEI:</strong> NO hay refund técnico. El merchant tiene que enviar withdrawal manual al CLABE</li>
                  <li>❌ <strong>OXXOPay / Cash Voucher:</strong> no reversible. El merchant tiene que enviar withdrawal</li>
                </ul>
              </CaseCard>

              <CaseCard title="Caso 3 · Mi withdrawal está pendiente / no llegó" escalateTo="Roberto si está `failed`">
                <ol className="text-sm text-gray-700 space-y-1.5 list-decimal pl-5">
                  <li>Pídele al merchant el <code className="font-mono text-xs">withdrawal_id</code> o el CLABE de destino</li>
                  <li><code className="font-mono text-xs text-violet-700">@Pascal get_withdrawal_status &lt;id&gt;</code></li>
                  <li>Estados posibles:
                    <ul className="mt-1 ml-4 space-y-0.5 text-[13px]">
                      <li>• <code>pending</code> → en cola, espera 5-15 min</li>
                      <li>• <code>processing</code> → enviado al banco, espera 30-60 min</li>
                      <li>• <code>completed</code> → ya llegó</li>
                      <li>• <code>failed</code> → escala a <strong>Roberto</strong> con el motivo</li>
                    </ul>
                  </li>
                </ol>
              </CaseCard>

              <CaseCard title="Caso 4 · Mi acceptance rate bajó" escalateTo="Sandy si hay decline codes raros o patrones nuevos">
                <ol className="text-sm text-gray-700 space-y-1.5 list-decimal pl-5">
                  <li><code className="font-mono text-xs text-violet-700">@Pascal get_acceptance_rate último mes</code></li>
                  <li><code className="font-mono text-xs text-violet-700">@Pascal get_top_declines</code></li>
                  <li>Si ves un decline code raro o un patrón nuevo, escala a <strong>Sandy (Integrations)</strong></li>
                </ol>
              </CaseCard>

              <CaseCard title="Caso 5 · No puedo crear una cuenta de merchant" escalateTo="Geraldine (siempre, sin excepciones)">
                <p className="text-sm text-gray-700">
                  Account creation involucra MID/Acquirer y Geraldine es la dueña
                  del proceso. Crea ticket en Linear con el team{" "}
                  <code className="font-mono text-xs">mid</code> y asignalo a ella.
                </p>
              </CaseCard>

              <CaseCard title="Caso 6 · Preguntas técnicas de integración" escalateTo="Sandy si Pascal no sabe">
                <ol className="text-sm text-gray-700 space-y-1.5 list-decimal pl-5">
                  <li>Primero intenta <code className="font-mono text-xs text-violet-700">@Pascal</code> — tiene 13+ entradas de KB de integración</li>
                  <li>Si Pascal no sabe, escala a <strong>Sandy (Integrations Lead)</strong></li>
                  <li>Una vez resuelto, entrena a Pascal: <code className="font-mono text-xs text-violet-700">@Pascal learn: [pregunta] → [respuesta]</code></li>
                </ol>
              </CaseCard>
            </div>
          </Section>

          {/* §8 Escalación — LIVE team */}
          <Section
            id="escalacion"
            num={8}
            title="Cuándo y Cómo Escalar"
            subtitle="El equipo Tonder · datos en vivo"
          >
            {teamError ? (
              <Callout tone="warn" title="Live team data unavailable">
                No pudimos cargar el equipo desde <code>/api/people?type=tonder_team</code>.
                Avisa al equipo Pascal.
              </Callout>
            ) : team === null ? (
              <SkeletonRows />
            ) : team.length === 0 ? (
              <p className="text-sm text-gray-400 italic">
                No hay miembros del equipo registrados. Agrega contactos en{" "}
                <Link href="/people" className="text-violet-600 hover:text-violet-700 underline">
                  /people
                </Link>
                .
              </p>
            ) : (
              <div className="t-card t-card-flush overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Persona</th>
                        <th>Rol</th>
                        <th>Slack</th>
                        <th>Telegram</th>
                        <th>Cuándo escalarle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.map((p) => {
                        const domainCls = DOMAIN_COLORS[p.domain] ?? "bg-gray-100 text-gray-700";
                        return (
                          <tr key={p.id}>
                            <td>
                              <div className="font-medium text-gray-900">{p.name}</div>
                              {p.domain && (
                                <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${domainCls}`}>
                                  {p.domain}
                                </span>
                              )}
                            </td>
                            <td className="text-gray-700 text-[13px]">{p.role || "—"}</td>
                            <td>
                              {p.slack_user_id ? (
                                <code className="font-mono text-[11px] text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                                  {p.slack_user_id}
                                </code>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td>
                              {p.telegram_user_id ? (
                                <code className="font-mono text-[11px] text-gray-600 bg-gray-50 px-1.5 py-0.5 rounded">
                                  {p.telegram_user_id}
                                </code>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="text-[12px] text-gray-600 max-w-[280px]">
                              {p.escalation_notes || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Card title="Cómo crear un ticket en Linear" className="mt-4">
              <p className="text-sm text-gray-700 mb-3">
                Pascal puede crear tickets automáticamente con{" "}
                <code className="font-mono text-xs">create_internal_ticket</code>:
              </p>
              <pre className="text-[12px] bg-gray-50 rounded p-3 overflow-x-auto text-gray-800 font-mono">
{`@Pascal crea ticket para [team] sobre [tema]:
[descripción del problema]`}
              </pre>
              <p className="text-sm text-gray-700 mt-3 mb-2">Teams disponibles:</p>
              <ul className="text-sm text-gray-700 space-y-1">
                <li>• <code className="font-mono text-xs">int</code> — Integrations (Sandy)</li>
                <li>• <code className="font-mono text-xs">sos</code> — Soporte / FinOps (Roberto)</li>
                <li>• <code className="font-mono text-xs">finops</code> — FinOps específico (Roberto)</li>
                <li>• <code className="font-mono text-xs">mid</code> — Acquirer / MID (Geraldine)</li>
              </ul>
            </Card>

            <Callout tone="warn" title="Cuándo escalar inmediatamente (sin pasar por Pascal)">
              <ul className="text-sm space-y-1.5 mt-1">
                <li>• <strong>Producción está caída:</strong> el merchant no puede procesar nada → ping inmediato a Sandy + Roberto</li>
                <li>• <strong>Pérdida de dinero confirmada:</strong> un usuario pagó pero el merchant no recibió → Roberto</li>
                <li>• <strong>Sospecha de fraude:</strong> patrón anómalo de transacciones → Roberto</li>
                <li>• <strong>Quejas legales o regulatorias:</strong> escala a tu manager directamente</li>
              </ul>
            </Callout>
          </Section>

          {/* §9 Usando Pascal */}
          <Section id="pascal-dia-a-dia" num={9} title="Usando Pascal en tu Día a Día">
            <Card title="Cómo preguntarle a Pascal">
              <p className="text-sm text-gray-700 mb-3">
                Pascal entiende lenguaje natural en español o inglés. Ejemplos:
              </p>
              <pre className="text-[12px] bg-gray-50 rounded p-3 overflow-x-auto text-gray-800 font-mono leading-relaxed">
{`@Pascal busca la transacción 78234982374
@Pascal cuál es el acceptance rate de Vitau este mes?
@Pascal dame los top declines de Campobet últimos 7 días
@Pascal cuántas withdrawals tiene Stadiobet hoy?
@Pascal genera el refund receipt para payment_id 12345
@Pascal busca depósitos SPEI del 15 de mayo
@Pascal crea ticket para integrations sobre webhook timeout`}
              </pre>
            </Card>

            <Card title="Tools que Pascal tiene" className="mt-4">
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Para qué sirve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["lookup_by_id", "Universal — busca cualquier ID en todos los sistemas"],
                      ["get_acceptance_rate", "Tasas de aceptación por método"],
                      ["get_transaction_volume", "Volumen, conteo, ticket promedio"],
                      ["get_top_declines", "Top razones de rechazo"],
                      ["get_transactions_by_status", "Breakdown por estado"],
                      ["get_withdrawal_status", "Estado de withdrawals"],
                      ["lookup_spei_deposits", "Buscar depósitos SPEI"],
                      ["list_recent_transactions", "Últimas transacciones con filtros"],
                      ["list_recent_withdrawals", "Últimas withdrawals con filtros"],
                      ["generate_refund_receipt", "Genera PDF de comprobante de reembolso"],
                      ["create_internal_ticket", "Crea ticket en Linear"],
                    ].map(([tool, desc]) => (
                      <tr key={tool}>
                        <td><code className="font-mono text-[12px] text-violet-700">{tool}</code></td>
                        <td className="text-gray-700 text-[13px]">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <Card title="Cuándo Pascal NO puede ayudar">
                <ul className="text-sm text-gray-700 space-y-1.5">
                  <li>• <strong>Decisiones de política:</strong> &ldquo;¿debería darle un refund?&rdquo; — es decisión tuya/del merchant</li>
                  <li>• <strong>Conciliación financiera:</strong> Pascal no concilia, solo lee</li>
                  <li>• <strong>Acciones destructivas:</strong> Pascal NO procesa refunds reales, NO cambia configuraciones, NO toca dinero</li>
                  <li>• <strong>Confidencial:</strong> no te da fees, rates, settlements (eso es Roberto)</li>
                </ul>
              </Card>
              <Card title="Entrenando a Pascal">
                <p className="text-sm text-gray-700 mb-2">
                  Si Pascal no respondió bien algo, enséñale:
                </p>
                <pre className="text-[12px] bg-gray-50 rounded p-3 overflow-x-auto text-gray-800 font-mono">
{`@Pascal learn: cuando un merchant pregunta por "txid"
pero el ID es de BC Game, buscar en customer_order_id
en lugar de txid.`}
                </pre>
                <p className="text-xs text-gray-500 mt-2 italic">
                  Pascal guarda esto en el KB con embedding semántico y lo va a
                  recordar la próxima vez.
                </p>
              </Card>
            </div>
          </Section>

          {/* §10 Glosario */}
          <Section id="glosario" num={10} title="Glosario y Shorthand">
            <div className="grid md:grid-cols-2 gap-4">
              <Card title="Shorthand común en chats">
                <div className="overflow-x-auto">
                  <table className="t-table">
                    <thead>
                      <tr>
                        <th>Abreviación</th>
                        <th>Significado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["WD", "Withdrawal (retiro/payout)"],
                        ["TX", "Transaction (transacción)"],
                        ["dep", "Deposit (depósito)"],
                        ["ref", "Reference o Refund (depende del contexto)"],
                        ["txid", "Transaction ID"],
                        ["KYC", "Know Your Customer"],
                        ["MID", "Merchant Identification Number"],
                        ["APM", "Alternative Payment Method"],
                        ["AR", "Acceptance Rate"],
                      ].map(([abbr, meaning]) => (
                        <tr key={abbr}>
                          <td><code className="font-mono text-[12px] text-gray-800">{abbr}</code></td>
                          <td className="text-[13px] text-gray-700">{meaning}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card title="Glosario técnico">
                <dl className="text-sm space-y-2">
                  {[
                    ["Acquirer", "el banco/proveedor que procesa pagos con tarjeta para Tonder"],
                    ["Business ID", "identificador interno único de cada merchant en Tonder"],
                    ["CLABE", "clave bancaria estandarizada en México (18 dígitos)"],
                    ["Decline code", "código que devuelve el acquirer cuando rechaza"],
                    ["Fallback", "Pascal no pudo responder y devuelve mensaje genérico"],
                    ["FinOps", "Financial Operations — el equipo que concilia dinero"],
                    ["Gateway", "capa técnica entre merchant ↔ acquirer"],
                    ["Idempotency key", "ID único para evitar procesamiento duplicado"],
                    ["KB", "Knowledge base de Pascal (Postgres + embeddings)"],
                    ["Merchant", "el cliente de Tonder"],
                    ["Order ID", "identificador del lado del merchant"],
                    ["Payment ID", "identificador del lado de Tonder"],
                    ["Payout", "pago de Tonder al usuario (sinónimo de withdrawal)"],
                    ["Self-QA", "sistema interno donde Pascal evalúa su propia calidad"],
                    ["SPEI", "Sistema de Pagos Electrónicos Interbancarios (MX)"],
                    ["Webhook", "notificación HTTP que mandamos al merchant en cambios de estado"],
                  ].map(([term, def]) => (
                    <div key={term} className="flex gap-2">
                      <dt className="font-semibold text-gray-900 shrink-0">{term}:</dt>
                      <dd className="text-gray-700">{def}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </div>
          </Section>

          {/* §11 Decline Codes */}
          <Section id="decline-codes" num={11} title="Decline Codes Comunes">
            <p className="text-sm text-gray-600 mb-3">
              Cuando una transacción es rechazada, el acquirer devuelve un
              código. Los más comunes:
            </p>
            <div className="t-card t-card-flush overflow-hidden">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Significado</th>
                    <th>¿Qué decirle al usuario?</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["insufficient_funds", "Sin fondos", "Tu tarjeta no tiene saldo suficiente."],
                    ["do_not_honor", "Banco rechazó sin razón específica", "Tu banco rechazó la transacción, contáctalos."],
                    ["card_declined", "Rechazo genérico", "Tu banco rechazó la transacción."],
                    ["expired_card", "Tarjeta vencida", "Tu tarjeta está vencida, usa una vigente."],
                    ["invalid_cvv", "CVV incorrecto", "El código de seguridad (CVV) es incorrecto."],
                    ["incorrect_zip", "ZIP no coincide", "El código postal no coincide con tu tarjeta."],
                    ["suspected_fraud", "Sistema antifraude bloqueó", "Tu banco bloqueó la transacción por seguridad. Contáctalos."],
                    ["processor_declined", "Acquirer rechazó", "Hubo un error técnico, intenta de nuevo en unos minutos."],
                  ].map(([code, meaning, message]) => (
                    <tr key={code}>
                      <td>
                        <code className="font-mono text-[12px] text-gray-800 bg-gray-50 px-1.5 py-0.5 rounded">
                          {code}
                        </code>
                      </td>
                      <td className="text-[13px] text-gray-700">{meaning}</td>
                      <td className="text-[13px] text-gray-600 italic">&ldquo;{message}&rdquo;</td>
                    </tr>
                  ))}
                  <tr>
                    <td>
                      <code className="font-mono text-[12px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                        lost_card / stolen_card
                      </code>
                    </td>
                    <td className="text-[13px] text-gray-700">Tarjeta reportada</td>
                    <td className="text-[13px] text-red-700 font-medium">⚠️ NO le digas al usuario. Escala a Roberto.</td>
                  </tr>
                  <tr>
                    <td>
                      <code className="font-mono text-[12px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                        pickup_card
                      </code>
                    </td>
                    <td className="text-[13px] text-gray-700">Banco pidió retener tarjeta</td>
                    <td className="text-[13px] text-red-700 font-medium">⚠️ Escala a Roberto.</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-3">
              💡 Para análisis de patrones de decline, usa{" "}
              <code className="font-mono text-violet-700">@Pascal get_top_declines</code> y
              revisa la distribución por método y merchant.
            </p>
          </Section>

          {/* §12 Recursos */}
          <Section id="recursos" num={12} title="Recursos y Dashboards">
            <Card title="Páginas del Dashboard">
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Ruta</th>
                      <th>Para qué sirve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["/analytics", "Analytics de conversaciones de Pascal"],
                      ["/brain", "Knowledge graph + insights de IA"],
                      ["/chat", "Interfaz de chat directo con Pascal"],
                      ["/insights", "Roll-up de cómo está funcionando Pascal"],
                      ["/memory", "CRUD del knowledge base"],
                      ["/merchants", "Gestión de canales de merchant"],
                      ["/monitoring", "Health, incidents, QA, synthetic checks"],
                      ["/people", "Directorio del equipo + contactos de merchant"],
                      ["/replays", "Re-correr conversaciones contra el Pascal actual"],
                      ["/simulations", "Suite de regresión"],
                    ].map(([route, desc]) => (
                      <tr key={route}>
                        <td>
                          <Link
                            href={route}
                            className="font-mono text-[12px] text-violet-700 hover:text-violet-800 underline underline-offset-2"
                          >
                            {route}
                          </Link>
                        </td>
                        <td className="text-[13px] text-gray-700">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Comandos útiles de Pascal" className="mt-4">
              <pre className="text-[12px] bg-gray-50 rounded p-3 overflow-x-auto text-gray-800 font-mono leading-relaxed">
{`@Pascal learn: [nueva entrada al KB]
@Pascal busca [ID o referencia]
@Pascal status del withdrawal [ID]
@Pascal acceptance rate de [merchant] este mes
@Pascal crea ticket para [team] sobre [tema]`}
              </pre>
            </Card>

            <Card title="Linear" className="mt-4">
              <ul className="text-sm text-gray-700 space-y-1.5">
                <li>• Workspace: <code className="font-mono text-xs">tonderio</code></li>
                <li>• Project Pascal:{" "}
                  <a
                    href="https://linear.app/tonderio/project/pascal-6a069dcb5364"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-600 hover:text-violet-700 underline underline-offset-2"
                  >
                    linear.app/tonderio/project/pascal
                  </a>
                </li>
                <li>• Team AI &amp; Data — donde se crean tickets de mejoras a Pascal</li>
              </ul>
            </Card>
          </Section>

          {/* Checklist */}
          <section id="checklist" className="t-card fade-in d6 !p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Checklist de tu primera semana
                </h2>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  Tu progreso se guarda en este navegador (localStorage)
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-violet-700 leading-none">
                  {completedCount}<span className="text-gray-300 text-lg font-normal"> / {CHECKLIST.length}</span>
                </p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
                  Completado
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-5">
              <div
                className="h-full bg-violet-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>

            <ul className="space-y-1">
              {CHECKLIST.map((item) => {
                const isDone = !!done[item.id];
                return (
                  <li key={item.id}>
                    <label className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={() => toggle(item.id)}
                        className="w-4 h-4 accent-violet-600 cursor-pointer"
                      />
                      <span
                        className={`text-sm ${
                          isDone
                            ? "text-gray-400 line-through"
                            : "text-gray-800"
                        }`}
                      >
                        {item.label}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Footer */}
          <div className="text-center py-8 border-t border-gray-100">
            <p className="text-sm text-gray-600">
              <strong>¿Dudas?</strong> Pregúntale a{" "}
              <Link href="/chat" className="text-violet-600 hover:text-violet-700 font-medium underline underline-offset-2">
                Pascal
              </Link>{" "}
              primero — para eso está. Si Pascal no sabe o no debería saber,
              escala según §8.
            </p>
            <p className="text-base text-violet-700 font-semibold mt-3">
              Bienvenida al equipo. 🚀
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

/* ─── Sub-components ────────────────────────────────────────────── */

function Section({
  id,
  num,
  title,
  subtitle,
  children,
}: {
  id: string;
  num: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 fade-in d2">
      <div className="mb-4">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
            §{num}
          </span>
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        </div>
        {subtitle && (
          <p className="text-[12px] text-gray-500 mt-1 ml-7">{subtitle}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Card({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`t-card ${className ?? ""}`}>
      {title && (
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "danger" | "warn" | "info";
  title: string;
  children: React.ReactNode;
}) {
  const styles =
    tone === "danger"
      ? { bg: "rgba(254,242,242,0.7)", border: "#fecaca", titleColor: "text-red-800" }
      : tone === "warn"
        ? { bg: "rgba(254,252,232,0.7)", border: "#fde68a", titleColor: "text-amber-800" }
        : { bg: "rgba(239,246,255,0.7)", border: "#bfdbfe", titleColor: "text-blue-800" };

  return (
    <div
      className="rounded-xl p-4 mt-3"
      style={{
        background: styles.bg,
        borderColor: styles.border,
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <p className={`text-sm font-semibold ${styles.titleColor} mb-1`}>
        ⚠️ {title}
      </p>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

function CaseCard({
  title,
  escalateTo,
  children,
}: {
  title: string;
  escalateTo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="t-card">
      <p className="text-sm font-semibold text-gray-900 mb-2">{title}</p>
      {children}
      <p className="text-[11px] text-gray-500 mt-3 pt-3 border-t border-gray-100">
        → Escalar a: <strong className="text-gray-700">{escalateTo}</strong>
      </p>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="t-card space-y-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
      ))}
    </div>
  );
}
