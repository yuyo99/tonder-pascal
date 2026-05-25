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

interface SectionEntry {
  id: string;
  num: number;
  title: string;
  critical?: boolean;
}

interface SectionGroup {
  label: string;
  sections: SectionEntry[];
}

const SECTION_GROUPS: SectionGroup[] = [
  {
    label: "Manual",
    sections: [
      { id: "bienvenida", num: 1, title: "Bienvenida" },
      { id: "productos", num: 2, title: "Productos de Tonder" },
      { id: "metodos", num: 3, title: "Métodos de Pago" },
      { id: "provider-masking", num: 4, title: "🚨 Provider Masking", critical: true },
      { id: "merchants", num: 5, title: "Nuestros Merchants" },
      { id: "canales", num: 6, title: "Canales de Comunicación" },
    ],
  },
  {
    label: "Operación",
    sections: [
      { id: "casos-comunes", num: 7, title: "Problemas Comunes" },
      { id: "escalacion", num: 8, title: "Escalación" },
      { id: "estandares", num: 9, title: "Estándares de Excelencia" },
      { id: "op-diaria", num: 10, title: "Op. Diaria y Semanal" },
      { id: "nunca-permitido", num: 11, title: "🚫 Nunca Permitido", critical: true },
    ],
  },
  {
    label: "Referencia",
    sections: [
      { id: "pascal-dia-a-dia", num: 12, title: "Usando Pascal" },
      { id: "glosario", num: 13, title: "Glosario" },
      { id: "decline-codes", num: 14, title: "Decline Codes" },
      { id: "recursos", num: 15, title: "Recursos y Dashboards" },
    ],
  },
  {
    label: "Strategy",
    sections: [
      { id: "okrs", num: 16, title: "OKRs Q1 2026" },
      { id: "sops", num: 17, title: "SOPs Catalog" },
      { id: "accountability", num: 18, title: "Accountability" },
      { id: "qbr", num: 19, title: "QBR Q1 2026 · Archivo" },
    ],
  },
];

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

/* ─── CS_HUB v2 constants ───────────────────────────────────────── */

// The 7 principios del Customer Support en Tonder (CS_HUB §3.2)
const SEVEN_PRINCIPIOS: { title: string; body: string }[] = [
  { title: "Urgencia absoluta", body: "Responder rápido no es un plus, es el estándar. FPR < 3 minutos siempre." },
  { title: "Cero errores", body: "Cada validación SPEI, CLABE, payout o comentario sobre declines debe estar verificada 2 veces." },
  { title: "Operar como dueño", body: "Si algo está mal, no esperas, tú mueves al equipo correcto." },
  { title: "Resolver, no reenviar", body: "Las escalaciones deben ir completas, claras y con contexto. Nada de 'me dijeron que revisara esto'." },
  { title: "Ser los ojos del COO", body: "Tu trabajo detecta fallas en acquirers, merchants con problemas, patrones de fraude, bugs en el checkout y problemas de UX." },
  { title: "Documentar siempre", body: "Cada hallazgo queda registrado en Notion + Slack interno." },
  { title: "Mantener calma bajo presión", body: "iGaming es caótico → tú no." },
];

// Patrones recurrentes observados por merchant (CS_HUB §10.10)
const MERCHANT_PATTERNS: { merchant: string; pattern: string }[] = [
  { merchant: "BC Game", pattern: "Callbacks, withdrawals state mismatches, ID practices (customer_order_id vs txid)." },
  { merchant: "PB-IDEM", pattern: "API stability, dispute/chargeback risk, refund execution." },
  { merchant: "Stadiobet", pattern: "Reconciliation y reporting trust — recuperaciones manuales." },
  { merchant: "FUN88", pattern: "Settlement expectations + STP latency (fines de semana / holidays)." },
  { merchant: "Campobet (PGW/Pesix)", pattern: "Frictionless reference behavior, ID/search y SDK expectations." },
];

// Plantillas de respuesta oficiales (CS_HUB §3.8)
const RESPONSE_TEMPLATES: { title: string; tone: "spei" | "decline" | "payout"; body: string }[] = [
  {
    title: "SPEI · Monto incorrecto",
    tone: "spei",
    body: "El pago no se acreditó porque el monto enviado no coincide con el monto del voucher generado.\n\nTe comparto el monto correcto y la CLABE a utilizar para evitar errores en futuros pagos.",
  },
  {
    title: "SPEI · CLABE incorrecta",
    tone: "spei",
    body: "El pago fue enviado a una CLABE diferente a la asignada. Esto impide que podamos acreditar el depósito.\n\nTe comparto la CLABE correcta para que puedas reenviar el pago o solicitar devolución en tu banco.",
  },
  {
    title: "Declines de tarjeta",
    tone: "decline",
    body: "Estamos recibiendo un decline directo del banco emisor. La tarjeta requiere autorización del banco o intentar con otro método de pago.\n\nNo es un error de Tonder ni del comercio.",
  },
  {
    title: "Payout error",
    tone: "payout",
    body: "El payout no pudo procesarse debido a una CLABE inválida o rechazada por el banco destino.\n\nTe compartimos la razón exacta y cómo corregirla.",
  },
];

// Tipos de ticket + checklist de resolución (CS_HUB §3.7)
const TICKET_TYPES: { title: string; causes: string[]; steps: string[] }[] = [
  {
    title: "Tipo 1 · SPEI Pagado Incorrectamente",
    causes: ["Monto incorrecto", "Pagaron a otra CLABE", "STP rechazó", "Referencia incorrecta"],
    steps: ["Validar CLABE", "Validar banco", "Validar monto", "Validar timestamp", "Confirmar en logs", "Responder con precisión", "Si aplica → escalar a PayOps"],
  },
  {
    title: "Tipo 2 · Declines de Tarjeta",
    causes: ["Fondos insuficientes", "Banco bloqueando por riesgo", "Error técnico del acquirer", "3DS obligatorio fallido"],
    steps: ["Revisar motivo de decline", "Revisar comportamiento por BIN", "Ver si otros merchants presentan el mismo patrón", "Identificar si es un banco específico", "Determinar si es un issue o comportamiento normal"],
  },
  {
    title: "Tipo 3 · Payouts",
    causes: ["CLABE inválida", "Límite del merchant", "Horarios de operación", "Acquirer offline"],
    steps: ["Validar CLABE de destino", "Validar tiempos del acquirer", "Verificar límites del merchant", "Confirmar si el acquirer está operando"],
  },
  {
    title: "Tipo 4 · OxxoPay",
    causes: ["Pagos duplicados", "Pago parcial", "Código vencido", "Confirmación tardía"],
    steps: ["Revisar código de pago", "Validar monto recibido", "Confirmar timestamp vs expiración", "Cruzar con confirmación del proveedor"],
  },
];

// Mapping canónico feature → owners (CS_HUB §5.1)
const FEATURE_OWNERS: { feature: string; topic: string; owners: string[] }[] = [
  { feature: "Withdrawals", topic: "withdrawals", owners: ["Fabio Do Carma Luna", "Arturo Torres"] },
  { feature: "Tarjetas", topic: "tarjetas", owners: ["Lenin Gomez", "Arturo Torres"] },
  { feature: "OxxoPay", topic: "oxxopay", owners: ["Lenin Gomez", "Arturo Torres"] },
  { feature: "SPEI", topic: "spei", owners: ["Arturo Torres", "Gabriel Yañez"] },
  { feature: "Paysafe", topic: "paysafe", owners: ["Gabriel Yañez", "Arturo Torres"] },
  { feature: "Settlements", topic: "settlements", owners: ["Roberto Lomelli", "Eugenio Orozco"] },
  { feature: "Fees / Pricing", topic: "fees", owners: ["Geraldine Sprockel", "Eugenio Orozco"] },
  { feature: "Webhooks", topic: "webhooks", owners: ["Guillermo Quintero", "Arturo Torres"] },
  { feature: "Links de Pago", topic: "links-de-pago", owners: ["Guillermo Quintero", "Arturo Torres"] },
  { feature: "Save cards / SDKs / Hosted Checkout", topic: "save-cards", owners: ["David Hernandez", "Arturo Torres"] },
  { feature: "Direct API", topic: "direct-api", owners: ["Fabio Do Carma Luna", "Arturo Torres"] },
  { feature: "Ionic SDK", topic: "ionic-sdk", owners: ["David Hernandez", "Arturo Torres"] },
  { feature: "Skyflow tokenization", topic: "skyflow", owners: ["Fabio Do Carma Luna", "Arturo Torres"] },
];

// SOPs catalog (CS_HUB §7)
const SOP_CATALOG: { name: string; contact: string; workflow: string; tools: string }[] = [
  { name: "BC Game Transaction Status", contact: "Eugenio Orozco", workflow: "Deposit Status", tools: "Metabase" },
  { name: "BC Game Withdrawal not found", contact: "Eugenio Orozco", workflow: "Withdrawals Status", tools: "Metabase" },
  { name: "Balance / Settlement discrepancies", contact: "Roberto Lomelli", workflow: "Reconciliation issues", tools: "Slack" },
  { name: "Comprobante Bancario (Bank Receipt) – STP", contact: "David Contreras", workflow: "Bank receipt", tools: "STP" },
  { name: "SPEI – Monto incorrecto", contact: "David Contreras", workflow: "SPEI", tools: "—" },
  { name: "SPEI – CLABE incorrecta", contact: "David Contreras", workflow: "SPEI", tools: "—" },
  { name: "SPEI – Pago fuera de tiempo", contact: "David Contreras", workflow: "SPEI", tools: "—" },
  { name: "SPEI – Duplicado", contact: "Eugenio Orozco", workflow: "SPEI", tools: "—" },
  { name: "Razón de declines de tarjeta / Kushki", contact: "David Contreras", workflow: "Cards", tools: "—" },
  { name: "3DS fallido", contact: "Eugenio Orozco", workflow: "Cards", tools: "—" },
  { name: "Payout rechazado por CLABE", contact: "David Contreras", workflow: "Payouts", tools: "—" },
  { name: "Payout fuera de horario", contact: "David Contreras", workflow: "Payouts", tools: "—" },
  { name: "OxxoPay – Código vencido", contact: "David Contreras", workflow: "OxxoPay", tools: "—" },
  { name: "OxxoPay – Pago parcial", contact: "David Contreras", workflow: "OxxoPay", tools: "—" },
  { name: "Incidente masivo (acquirer caído)", contact: "David Contreras", workflow: "Major incident", tools: "—" },
  { name: "Reason for withdrawal failure", contact: "David Contreras", workflow: "Withdrawals Status", tools: "Metabase" },
  { name: "OXXO Pay voucher enviado sin localización de ID", contact: "David Contreras", workflow: "OxxoPay Receipt", tools: "DynamoDB, Slack" },
  { name: "Callbacks para estado success", contact: "Fabio Do Carma Luna", workflow: "Deposit Status", tools: "—" },
  { name: "Envío de CEP (Comprobante Electrónico de Pago)", contact: "David Contreras", workflow: "Bank receipt", tools: "Metabase" },
  { name: "Gestión de Blacklist / Whitelist (Tonder Admin Console)", contact: "David Contreras", workflow: "Antifraud false positive", tools: "Tonder Admin Console" },
];

// OKRs Q1 2026 (CS_HUB §4)
const OKR_OBJECTIVES: { goal: string; tagline: string; krs: string[] }[] = [
  {
    goal: "Elevar la experiencia del merchant a un soporte claro, rápido y confiable",
    tagline: "El merchant sabe qué pasó, cuándo se resuelve y quién es responsable.",
    krs: [
      "Alcanzar SLA de primera respuesta ≤ 5 minutos en tickets críticos (P1).",
      "Resolver ≥ 90% de tickets P1 en menos de 2 horas.",
      "Implementar clasificación clara de severidades (P1-P4) y que el 100% de tickets esté correctamente etiquetado.",
      "Lograr que ≥ 70% de tickets se resuelvan en L0 sin escalar a Tech ni Ops.",
    ],
  },
  {
    goal: "Profesionalizar y estandarizar la operación de Customer Support",
    tagline: "Menos improvisación, más sistema.",
    krs: [
      "Documentar y publicar SOPs del 100% de los flujos críticos: SPEI issues, Declines / success rate drops, Refunds & frictionless, Payout delays, Webhooks & callbacks.",
      "Reducir el tiempo promedio de resolución (TTR) en 25%.",
      "Crear playbooks por merchant tipo (iGaming, wallets, cash) y usarlos en ≥ 80% de los tickets.",
      "Implementar handoff estructurado Support → PayOps / RiskOps / Tech en el 100% de escalaciones.",
    ],
  },
  {
    goal: "Pasar de soporte reactivo a soporte preventivo",
    tagline: "Detectar problemas antes de que el merchant grite.",
    krs: [
      "Crear alertas automáticas para caídas de success rate, spikes de declines, retrasos de payouts (≥ 5 alertas productivas en Q1).",
      "Resolver ≥ 40% de incidentes antes de que el merchant levante ticket.",
      "Enviar reportes proactivos semanales a los top merchants (Top 10 por TPV).",
      "Reducir incidentes repetidos del mismo tipo en 30%.",
    ],
  },
];

// Estándares de excelencia (CS_HUB §3.10)
const STANDARDS: { metric: string; target: string }[] = [
  { metric: "First Personal Response (FPR)", target: "< 3 minutos" },
  { metric: "Resolución completa (TTR)", target: "< 45 minutos" },
  { metric: "Errores operacionales por mes", target: "0-1" },
  { metric: "Seguimiento a casos críticos", target: "Inmediato" },
  { metric: "Comunicación", target: "Profesional, simple, directa" },
  { metric: "Aproximación", target: "Proactividad > reacción" },
  { metric: "Merchants informados", target: "Siempre" },
  { metric: "Documentación en Notion", target: "Impecable" },
  { metric: "Detección temprana de issues masivos", target: "Antes que el merchant" },
  { metric: "Tickets abandonados o duplicados", target: "Cero" },
];

// Checklists Diario / Semanal (CS_HUB §3.5, §3.6)
const DAILY_CHECKLIST: string[] = [
  "Revisar alertas de declines — cambios > 5% requieren análisis. Notificar al COO si BBVA se cae, Unlimit baja, etc.",
  "Revisar SPEI — verificar errores del día. Confirmar depósitos altos manualmente (si aplica).",
  "Revisar tickets críticos — SPEI, Payouts, caídas de acquirer, problemas del checkout.",
  "Responder todos los tickets dentro del SLA — FPR < 3 min, Resolución < 45 min.",
  "Reporte diario al COO — 3-5 puntos clave.",
  "Actualizar Notion — casos recurrentes, problemas de merchants, mejoras sugeridas.",
];

const WEEKLY_CHECKLIST: string[] = [
  "Reporte semanal completo al COO — declines, caídas de acquirers, SPEIs erróneos, payouts con errores, merchants con más tickets, sugerencias para producto.",
  "Revisión del Playbook — que esté actualizado.",
  "Revisión de SLA's — evolución semanal.",
  "Reunión con PayOps — retroalimentación, mejoras operativas.",
  "Revisión de incidentes — evaluar patrones.",
];

// Lo que NUNCA se permite (CS_HUB §3.11)
const NEVER_ALLOWED: string[] = [
  "Responder sin validar",
  "Escalar sin contexto",
  "Decir 'no sé' sin intentar resolver",
  "Cerrar tickets sin confirmación",
  "Dejar tickets abiertos 24h+",
  "No reportar una caída de acquirer",
  "No informar un SPEI sospechoso",
];

// Accountability chart owner + métricas semanales (CS_HUB §9)
const ACCOUNTABILITY_OWNER = "David Contreras";
const ACCOUNTABILITY_METRICS: { metric: string; measures: string; target: string }[] = [
  { metric: "Respondiendo a tiempo dentro de Shift", measures: "Rapidez de comunicación", target: "< 3 min" },
  { metric: "Escalando correctamente tickets a Tech y FinOps", measures: "Control de tickets y comunicación", target: "100%" },
  { metric: "Reportes semanales y mensuales", measures: "Documentación y mediciones", target: "100%" },
];

// SOS contacts after-hours (CS_HUB §5.2)
const SOS_CONTACTS: { who: string; topic: string; phone: string }[] = [
  { who: "Eugenio Orozco", topic: "Operaciones · FinOps · Chargebacks · Success Rates", phone: "+52 1 81 1531 5741" },
  { who: "Arturo Torres", topic: "Tecnología · Bugs · issues de estados", phone: "+52 55 5412 7692" },
];

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
        <aside className="hidden lg:block sticky top-[76px] self-start w-[230px] shrink-0 max-h-[calc(100vh-100px)] overflow-y-auto">
          <nav className="t-card !p-3 text-[13px]">
            {SECTION_GROUPS.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.sections.map((s) => (
                    <a
                      key={s.id}
                      href={`#${s.id}`}
                      className={`flex items-baseline gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50 transition-colors ${
                        s.critical ? "text-red-700 font-medium" : "text-gray-700"
                      }`}
                    >
                      <span className="text-gray-400 text-[11px] w-4 shrink-0">
                        {s.num}
                      </span>
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div className="h-px bg-gray-100 my-3" />
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
                  <strong>Procesador de pagos</strong> con sede en México.
                  Conectamos a merchants con múltiples redes (acquirers,
                  gateways, bancos) a través de una sola integración. El
                  merchant integra Tonder una vez y nosotros enrutamos cada
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

            {/* CS_HUB §1 Misión */}
            <Card title="⛳ Misión del Customer Support" className="mt-4">
              <p className="text-sm text-gray-700 leading-relaxed italic">
                &ldquo;Transformar el caos en claridad, problemas en soluciones,
                y fricción en confianza con velocidad. Cada ticket resuelto es
                una oportunidad para elevar a nuestros merchants y demostrar lo
                que significa operar con estándares world-class.&rdquo;
              </p>
              <p className="text-[12px] text-gray-500 mt-3">
                Eres <strong>guardián del ritmo de Tonder</strong>: detectas
                antes que nadie, actúas más rápido que todos y resuelves con la
                disciplina y el orgullo de quien sabe que su trabajo sostiene la
                infraestructura que impulsa a toda una industria.
              </p>
            </Card>

            {/* CS_HUB §3.2 — Los 7 Principios */}
            <Card title="🏆 Los 7 Principios del Customer Support" className="mt-4">
              <ol className="space-y-3 mt-1">
                {SEVEN_PRINCIPIOS.map((p, i) => (
                  <li key={p.title} className="flex gap-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-[11px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{p.title}</p>
                      <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{p.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>

            {/* CS_HUB §2 — Job Description (collapsible) */}
            <div className="mt-4">
              <CollapsibleCard
                eyebrow="Referencia · hiring"
                title="Job Description — Customer Support Executive"
                subtitle="La descripción oficial del rol, requisitos, habilidades deseables y cualidades ideales"
              >
                <div className="space-y-4 text-sm text-gray-700 leading-relaxed">
                  <p>
                    Tonder es una plataforma de procesamiento de pagos de
                    nueva generación para negocios de alto rendimiento. Buscamos
                    <strong> Ejecutivos de Soporte al Cliente</strong> para el equipo
                    de <strong>Operaciones</strong>, como primera línea entre los
                    merchants y los equipos internos: <strong>FinOps, PayOps,
                    RiskOps y Tech.</strong>
                  </p>

                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      🎯 Responsabilidades clave
                    </p>
                    <ul className="space-y-1 pl-4 list-disc">
                      <li>Soporte <strong>bilingüe (inglés y español)</strong>.</li>
                      <li>Depósitos, retiros, contracargos, conciliaciones y tiempos de liquidación.</li>
                      <li>Usar Payment Operations DB, FinOps DB y Antifraud Engine.</li>
                      <li>Escalar a FinOps / RiskOps / Tech siguiendo el protocolo.</li>
                      <li>Documentar en Notion / Zendesk / Freshdesk con precisión.</li>
                      <li>Monitorear estados de transacción, demoras de adquirentes y confirmaciones de retiros en México y Chile.</li>
                      <li>Identificar problemas recurrentes y colaborar en mejoras preventivas.</li>
                      <li>Apoyar reportes y análisis de merchants (success rate, reservas, demoras).</li>
                      <li>Contribuir a manuales, FAQs y playbooks internos.</li>
                    </ul>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Requisitos</p>
                      <ul className="space-y-1 pl-4 list-disc">
                        <li>Fluidez inglés y español</li>
                        <li>1-3 años en pagos / fintech / iGaming ops</li>
                        <li>Flujos: depósitos, retiros, settlements, CB, KYC</li>
                        <li>Multicanal: WhatsApp, Telegram, Email, Zendesk, Teams</li>
                        <li>Google Sheets / Excel, Notion, Databricks / Metabase</li>
                        <li>Turnos rotativos / fines de semana (24/7)</li>
                      </ul>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Deseables</p>
                      <ul className="space-y-1 pl-4 list-disc">
                        <li>Experiencia en PSP / adquirente / agregador</li>
                        <li>Flujos SPEI, tarjetas, APM</li>
                        <li>Prevención de fraude, gestión de disputas, contracargos</li>
                        <li>Comprensión básica de Guardian (capacitación incluida)</li>
                      </ul>
                    </div>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Cualidades ideales</p>
                    <ul className="space-y-1 pl-4 list-disc">
                      <li><strong>Resolutivo:</strong> va más allá del problema y ataca la causa raíz</li>
                      <li><strong>Comunicador empático:</strong> adapta tono y enfoque según el merchant</li>
                      <li><strong>Operacionalmente agudo:</strong> entiende settlement, tasas de éxito, lógica de transacciones</li>
                      <li><strong>Analítico:</strong> interpreta datos y detecta anomalías</li>
                      <li><strong>Colaborativo:</strong> trabaja con FinOps, PayOps, RiskOps y Tech</li>
                      <li><strong>Disciplinado:</strong> múltiples merchants y tickets con consistencia</li>
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px] pt-2 border-t border-gray-100">
                    <div>
                      <p className="text-gray-400 uppercase tracking-wider text-[10px]">Tipo</p>
                      <p className="text-gray-700 font-medium">Tiempo completo</p>
                    </div>
                    <div>
                      <p className="text-gray-400 uppercase tracking-wider text-[10px]">Ubicación</p>
                      <p className="text-gray-700 font-medium">Remoto / Híbrido LATAM</p>
                    </div>
                    <div>
                      <p className="text-gray-400 uppercase tracking-wider text-[10px]">Turno</p>
                      <p className="text-gray-700 font-medium">Rotativo (24/7)</p>
                    </div>
                    <div>
                      <p className="text-gray-400 uppercase tracking-wider text-[10px]">Reporta a</p>
                      <p className="text-gray-700 font-medium">Head of Operations</p>
                    </div>
                  </div>
                </div>
              </CollapsibleCard>
            </div>
          </Section>

          {/* §2 Productos */}
          <Section id="productos" num={2} title="Productos de Tonder">
            <div className="grid md:grid-cols-2 gap-4">
              <Card title="Procesamiento de Pagos">
                <p className="text-sm text-gray-700 leading-relaxed mb-2">
                  Tonder es un <strong>procesador de pagos</strong>. El merchant
                  envía una transacción a nuestra API y nosotros la procesamos a
                  través del proveedor óptimo (acquirer, gateway o banco).
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

            {/* CS_HUB §3.4 — Conocimiento Técnico Obligatorio */}
            <div className="mt-6">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Conocimiento técnico obligatorio
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                <Card title="SPEI (STP / Bitso)">
                  <p className="text-sm text-gray-700 mb-2">Debes dominar:</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• Cómo validar un SPEI (montos, CLABE, referencia, rastreo)</li>
                    <li>• Diferencias entre STP y Bitso</li>
                    <li>• Razones típicas de error: monto incorrecto, CLABE incorrecta, duplicado, pago expirado</li>
                    <li>• Cómo identificar banco a partir de CLABE</li>
                    <li>• Cómo reconocer SPEI sospechosos (riesgo o fraude)</li>
                  </ul>
                </Card>
                <Card title="Cards (Kushki / Unlimit)">
                  <p className="text-sm text-gray-700 mb-2">Debes entender:</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• Declines <strong>soft vs hard</strong></li>
                    <li>• Bancos más sensibles: <strong>BBVA, Banorte, Santander</strong></li>
                    <li>• 3DS obligatorio y exenciones</li>
                    <li>• Behaviour por BIN local vs extranjero</li>
                    <li>• Motivos comunes de decline real del banco vs decline técnico</li>
                  </ul>
                </Card>
                <Card title="Payouts">
                  <p className="text-sm text-gray-700 mb-2">Debes dominar:</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• Validación de CLABE de destino</li>
                    <li>• Tiempos por acquirer</li>
                    <li>• Errores comunes</li>
                    <li>• Límites por merchant</li>
                    <li>• Señales de intento de fraude</li>
                  </ul>
                </Card>
                <Card title="OxxoPay / Cash">
                  <p className="text-sm text-gray-700 mb-2">Conocer:</p>
                  <ul className="text-sm text-gray-700 space-y-1">
                    <li>• Códigos vencidos</li>
                    <li>• Diferencias entre montos</li>
                    <li>• Pagos parciales</li>
                    <li>• Errores del POS</li>
                    <li>• Confirmación técnica del proveedor</li>
                  </ul>
                </Card>
              </div>
              <p className="text-[11px] text-gray-400 mt-3 italic">
                Estos nombres de proveedor (Kushki, Unlimit, STP, Bitso) son
                referencias internas — esta página es interna, no expuesta al
                merchant. Ver §4 para la regla de masking en comunicación externa.
              </p>
            </div>
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

            <Callout tone="info" title="Aplica solo a comunicación externa">
              Esta regla aplica únicamente a comunicación <strong>externa</strong>:
              chats con merchants, tickets visibles a merchants, comprobantes y
              emails. La documentación <strong>interna</strong> — esta página, los
              runbooks de Notion, las alertas internas, los SOPs en §17 y los
              detalles técnicos en §3 — <strong>puede mencionar libremente</strong>{" "}
              <code className="font-mono text-[11px]">Kushki</code>,{" "}
              <code className="font-mono text-[11px]">Unlimit</code>,{" "}
              <code className="font-mono text-[11px]">STP</code>,{" "}
              <code className="font-mono text-[11px]">Bitso</code>, etc. Si tu
              audiencia es el equipo Tonder, los nombres reales son OK.
            </Callout>

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

            {/* CS_HUB §10.10 — patrones observados Q1 2026 */}
            <Card title="Patrones recurrentes observados (Q1 2026)" className="mt-4">
              <p className="text-sm text-gray-600 mb-3">
                Estos son los temas que dominaron las escalaciones del Q1 2026.
                Útiles para anticipar qué tipo de issue puedes esperar de cada
                cuenta. Detalle completo en §19.
              </p>
              <ul className="space-y-2">
                {MERCHANT_PATTERNS.map((p) => (
                  <li key={p.merchant} className="text-sm">
                    <strong className="text-gray-900">{p.merchant}:</strong>{" "}
                    <span className="text-gray-700">{p.pattern}</span>
                  </li>
                ))}
              </ul>
            </Card>
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

            {/* CS_HUB §3.7 — Catálogo de tipos de ticket */}
            <Card title="Tipos de ticket — checklist de resolución" className="mt-6">
              <p className="text-sm text-gray-600 mb-3">
                Cuando un ticket entra, identifica primero su tipo. Cada tipo
                tiene un checklist estandarizado para no olvidar pasos.
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {TICKET_TYPES.map((t) => (
                  <div key={t.title} className="border border-gray-100 rounded-lg p-3">
                    <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                    <p className="text-[11px] text-gray-400 uppercase tracking-wider mt-2 mb-1">
                      Causas comunes
                    </p>
                    <ul className="text-[13px] text-gray-700 space-y-0.5 mb-3">
                      {t.causes.map((c) => (
                        <li key={c}>• {c}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">
                      Resolución
                    </p>
                    <ol className="text-[13px] text-gray-700 space-y-0.5 list-decimal pl-4">
                      {t.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </Card>

            {/* CS_HUB §3.8 — Plantillas de respuesta oficiales */}
            <Card title="Plantillas de respuesta (copy / paste)" className="mt-4">
              <p className="text-sm text-gray-600 mb-3">
                Tono profesional, directo y sin rodeos. Adapta el contexto
                pero respeta la estructura.
              </p>
              <div className="space-y-3">
                {RESPONSE_TEMPLATES.map((t) => (
                  <div key={t.title} className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-3 py-1.5 flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-700 uppercase tracking-wider">
                        {t.title}
                      </span>
                    </div>
                    <pre className="text-[13px] text-gray-800 p-3 leading-relaxed whitespace-pre-wrap font-sans">
{t.body}
                    </pre>
                  </div>
                ))}
              </div>
            </Card>
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

            {/* §8a — feature-owners LIVE table (CS_HUB §5.1) */}
            <Card title="Escalations por feature · taggear en #escalations" className="mt-4">
              <p className="text-sm text-gray-600 mb-3">
                Para issues específicos de una feature, taggea directamente al
                owner correspondiente. Datos en vivo: si el nombre tiene Slack
                ID a la derecha es porque está en{" "}
                <Link href="/people?type=tonder_team" className="text-violet-600 hover:text-violet-700 underline underline-offset-2">
                  /people
                </Link>
                .
              </p>
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Owners</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FEATURE_OWNERS.map((row) => (
                      <tr key={row.feature}>
                        <td className="font-medium text-gray-900">{row.feature}</td>
                        <td>
                          <div className="flex flex-col gap-1">
                            {row.owners.map((name) => (
                              <OwnerCell key={name} name={name} team={team} />
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* §8b — SOS After Hours (CS_HUB §5.2) */}
            <Card title="📞 SOS — After Hours" className="mt-4">
              <p className="text-sm text-gray-600 mb-3">
                Para issues fuera de horario que NO pueden esperar. Llamada
                directa, no Slack.
              </p>
              <div className="space-y-3">
                {SOS_CONTACTS.map((c) => (
                  <div
                    key={c.who}
                    className="flex items-center gap-4 p-3 rounded-lg border border-amber-200"
                    style={{ background: "rgba(254,252,232,0.5)" }}
                  >
                    <div className="text-2xl">📞</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{c.who}</p>
                      <p className="text-[12px] text-gray-600">{c.topic}</p>
                    </div>
                    <a
                      href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}
                      className="font-mono text-[13px] text-amber-700 hover:text-amber-900 font-semibold whitespace-nowrap"
                    >
                      {c.phone}
                    </a>
                  </div>
                ))}
              </div>
            </Card>

            {/* §8c — Reglas de escalación CS_HUB §6 */}
            <Card title="Reglas de escalación · qué equipo cubre qué" className="mt-4">
              <ul className="text-sm text-gray-700 space-y-1.5 mb-4">
                <li>• Si <strong>no es técnico</strong> y es <strong>solucionable</strong> → tú respondes directamente</li>
                <li>• Si el merchant está en <strong>integración</strong> → loop in <strong>Integration Manager</strong></li>
                <li>• Si requiere <strong>revisión de datos</strong> → escala a FinOps / PayOps / RiskOps</li>
                <li>• Si es <strong>sistemas, API, bugs</strong> → escala a <strong>Tech immediately</strong></li>
              </ul>
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>Cubre</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>FinOps</strong></td>
                      <td className="text-gray-700 text-[13px]">Settlements, rolling reserves, payouts, balances, fees</td>
                    </tr>
                    <tr>
                      <td><strong>PayOps</strong></td>
                      <td className="text-gray-700 text-[13px]">Declines, payment flows, approval rates, routing</td>
                    </tr>
                    <tr>
                      <td><strong>RiskOps</strong></td>
                      <td className="text-gray-700 text-[13px]">Chargebacks, disputes, fraud patterns, rules</td>
                    </tr>
                    <tr>
                      <td><strong>Tech</strong></td>
                      <td className="text-gray-700 text-[13px]">Bugs, errors, outages, API issues, dashboard issues</td>
                    </tr>
                    <tr>
                      <td><strong>Customer Success Manager</strong></td>
                      <td className="text-gray-700 text-[13px]">KYB / compliance, technical meetings, pricing, contratos</td>
                    </tr>
                    <tr>
                      <td><strong>Integration Manager</strong></td>
                      <td className="text-gray-700 text-[13px]">Preguntas técnicas de merchants en integración, technical certification</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-3 italic">
                Routing rápido: Tech (Arturo) para checkout/API/3DS · FinOps
                (Yuyo) para SPEI/depósitos/retiros/settlement · Customer Success
                (Geraldine) para pricing/nuevos productos/sesiones técnicas.
              </p>
            </Card>
          </Section>

          {/* §9 Estándares de Excelencia — NEW (CS_HUB §3.10) */}
          <Section
            id="estandares"
            num={9}
            title="Estándares de Excelencia"
            subtitle="Los 10 estándares operacionales que definen el rol"
          >
            <div className="t-card t-card-flush overflow-hidden">
              <table className="t-table">
                <thead>
                  <tr>
                    <th>Métrica</th>
                    <th>Target</th>
                  </tr>
                </thead>
                <tbody>
                  {STANDARDS.map((s) => (
                    <tr key={s.metric}>
                      <td className="text-gray-800">{s.metric}</td>
                      <td>
                        <span className="t-badge t-badge-emerald font-mono">
                          {s.target}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* §10 Operación Diaria y Semanal — NEW (CS_HUB §3.5, §3.6) */}
          <Section
            id="op-diaria"
            num={10}
            title="Operación Diaria y Semanal"
            subtitle="Listas obligatorias · referencia, NO se guarda tu progreso (resetean cada día / semana)"
          >
            <div className="grid md:grid-cols-2 gap-4">
              <Card title="Checklist diario (obligatorio)">
                <ul className="space-y-2">
                  {DAILY_CHECKLIST.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <input type="checkbox" disabled className="w-4 h-4 mt-0.5 shrink-0 accent-violet-600 opacity-60" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Checklist semanal">
                <ul className="space-y-2">
                  {WEEKLY_CHECKLIST.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                      <input type="checkbox" disabled className="w-4 h-4 mt-0.5 shrink-0 accent-violet-600 opacity-60" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </Section>

          {/* §11 🚫 Lo Que NUNCA Se Permite — NEW (CS_HUB §3.11) */}
          <Section
            id="nunca-permitido"
            num={11}
            title="🚫 Lo Que NUNCA Se Permite"
            subtitle="Reglas duras — sin excepciones"
          >
            <Callout tone="danger" title="Estas conductas son inaceptables">
              <ul className="text-sm space-y-1.5 mt-2">
                {NEVER_ALLOWED.map((rule) => (
                  <li key={rule}>• {rule}</li>
                ))}
              </ul>
            </Callout>
          </Section>

          {/* §12 Usando Pascal (was §9) */}
          <Section id="pascal-dia-a-dia" num={12} title="Usando Pascal en tu Día a Día">
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
          <Section id="glosario" num={13} title="Glosario y Shorthand">
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
                        ["FPR", "First Personal Response (tiempo de primera respuesta)"],
                        ["TTR", "Time To Resolution"],
                        ["P1-P4", "Severidad de ticket (P1 = más crítico)"],
                        ["L0/L1/L2/L3", "Niveles de soporte (L0 = self-serve, L3 = tech/engineering)"],
                        ["TPV", "Total Payment Volume"],
                        ["CB", "Chargeback"],
                        ["POP", "Proof of Payment"],
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
                    ["3DS", "3D Secure — autenticación adicional para tarjetas"],
                    ["CEP", "Comprobante Electrónico de Pago"],
                    ["BIN", "Bank Identification Number (primeros 6 dígitos de tarjeta)"],
                    ["KYB", "Know Your Business"],
                    ["PSP", "Payment Service Provider"],
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
          <Section id="decline-codes" num={14} title="Decline Codes Comunes">
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

            <Callout tone="info" title="Bancos más sensibles">
              <strong>BBVA, Banorte y Santander</strong> son los emisores con
              mayor tasa de decline / fricción en México. Si ves un spike de
              declines, primero filtra por banco — si es uno de estos, suele ser
              un patrón del emisor (no de Tonder). Para tarjetas, el <strong>3DS</strong>{" "}
              suele ser obligatorio salvo exenciones por monto bajo o low-risk
              merchant.
            </Callout>
          </Section>

          {/* §15 Recursos (was §12) */}
          <Section id="recursos" num={15} title="Recursos y Dashboards">
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

          {/* §16 OKRs — Q1 2026 (CS_HUB §4) */}
          <Section
            id="okrs"
            num={16}
            title="OKRs — Q1 2026"
            subtitle="Tres objetivos · 12 key results · trimestre activo"
          >
            <div className="grid md:grid-cols-3 gap-4">
              {OKR_OBJECTIVES.map((obj, i) => (
                <div
                  key={i}
                  className="t-card relative"
                  style={{
                    background:
                      i === 0
                        ? "rgba(245,243,255,0.4)"
                        : i === 1
                          ? "rgba(236,253,245,0.4)"
                          : "rgba(254,252,232,0.4)",
                  }}
                >
                  <span className="absolute top-3 right-3 text-[9px] font-semibold text-gray-400 uppercase tracking-wider bg-white px-2 py-0.5 rounded-full border border-gray-200">
                    Q1 2026
                  </span>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Objetivo {i + 1}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 leading-snug mb-1">
                    {obj.goal}
                  </p>
                  <p className="text-[12px] text-gray-600 italic mb-3">{obj.tagline}</p>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mt-3 mb-1">
                    Key Results
                  </p>
                  <ol className="text-[13px] text-gray-700 space-y-2 list-decimal pl-4">
                    {obj.krs.map((kr) => (
                      <li key={kr}>{kr}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </Section>

          {/* §17 SOPs Catalog (CS_HUB §7) */}
          <Section
            id="sops"
            num={17}
            title="SOPs Catalog"
            subtitle="Procedimientos operativos estándar · detalle completo vive en Notion (Customer Support Hub)"
          >
            <div className="t-card t-card-flush overflow-hidden">
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>SOP</th>
                      <th>Escalation contact</th>
                      <th>Workflow</th>
                      <th>Tools</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SOP_CATALOG.map((sop) => (
                      <tr key={sop.name}>
                        <td className="text-gray-900 font-medium">{sop.name}</td>
                        <td>
                          <OwnerCell name={sop.contact} team={team} />
                        </td>
                        <td className="text-[13px] text-gray-700">{sop.workflow}</td>
                        <td className="text-[12px] text-gray-500">{sop.tools}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Section>

          {/* §18 Accountability Chart (CS_HUB §9) */}
          <Section
            id="accountability"
            num={18}
            title="Accountability Chart"
            subtitle="Quién es dueño de qué métrica · revisión semanal"
          >
            <Card title="Owner">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center font-semibold">
                  {ACCOUNTABILITY_OWNER.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </div>
                <div>
                  <OwnerCell name={ACCOUNTABILITY_OWNER} team={team} />
                  <p className="text-[12px] text-gray-500 mt-0.5">
                    Customer Support Specialist · responsable de las métricas semanales
                  </p>
                </div>
              </div>
            </Card>

            <Card title="Métricas semanales · target" className="mt-4">
              <div className="overflow-x-auto">
                <table className="t-table">
                  <thead>
                    <tr>
                      <th>Métrica</th>
                      <th>Qué mide</th>
                      <th>Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ACCOUNTABILITY_METRICS.map((m) => (
                      <tr key={m.metric}>
                        <td className="text-gray-900">{m.metric}</td>
                        <td className="text-[13px] text-gray-700">{m.measures}</td>
                        <td>
                          <span className="t-badge t-badge-emerald font-mono">{m.target}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-500 mt-3 italic">
                Nota de mejora del owner: crear mensajes genéricos como SOPs
                para contestar tipos de mensajes más rápido — ver §17.
              </p>
            </Card>
          </Section>

          {/* §19 Q1 2026 QBR (CS_HUB §10) — collapsible-by-default */}
          <section id="qbr" className="scroll-mt-20 fade-in d2">
            <CollapsibleCard
              eyebrow="§19 · Archivo histórico"
              title="Q1 2026 Business Review"
              subtitle="Jan 1 – Mar 31, 2026 · incidentes cuantificados, learnings, recomendaciones para Q2"
            >
              <div className="space-y-6 text-sm">
                {/* 10.1 Coverage */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Coverage</h4>
                  <ul className="text-gray-700 space-y-1 list-disc pl-5">
                    <li><strong>Daily reports revisados:</strong> 90 reports (Jan 1 – Mar 31, 2026)</li>
                    <li><strong>BC Game ticket bots:</strong> rangos 30-56/día con spikes (53 el Jan 8, 56 el Jan 14); Marzo bajó a 4-19/día</li>
                  </ul>
                </div>

                {/* 10.2 Eventos cuantificados */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Eventos cuantificados (ejemplos)</h4>
                  <div className="overflow-x-auto">
                    <table className="t-table">
                      <thead>
                        <tr>
                          <th>Categoría</th>
                          <th>Merchant</th>
                          <th>Qué pasó</th>
                          <th>Impacto</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="text-[13px]">CB/dispute risk por API instability</td>
                          <td className="text-[13px] font-medium">PB-IDEM</td>
                          <td className="text-[12px] text-gray-700">API errors causaron mismatch — algunas TXs procesadas mientras el merchant las veía como rechazadas</td>
                          <td className="text-[12px] text-red-700 font-medium">Merchant detuvo operación · USD 2M mensuales en riesgo</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Mass refunds para contener disputes</td>
                          <td className="text-[13px] font-medium">PB-IDEM</td>
                          <td className="text-[12px] text-gray-700">Refunds urgentes por transacciones duplicadas/erróneas</td>
                          <td className="text-[12px] text-amber-700 font-medium">133 refunds en un día</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Duplicate callback / incorrect payout</td>
                          <td className="text-[13px] font-medium">BC Game</td>
                          <td className="text-[12px] text-gray-700">Duplicación de callbacks en withdrawals → riesgo financiero y contable</td>
                          <td className="text-[12px] text-amber-700 font-medium">Compensación: 24,998 MXN · Settlement: 700,000 MXN</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Reconciliation / trust</td>
                          <td className="text-[13px] font-medium">Stadiobet</td>
                          <td className="text-[12px] text-gray-700">Reconciliación profunda con identificación de overpayments históricos</td>
                          <td className="text-[12px] text-emerald-700 font-medium">+18,724.81 MXN (Jan 2) · 15,970.27 MXN (Jan 7 recuperado)</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Operations blocked por missing IDs</td>
                          <td className="text-[13px] font-medium">FUN88</td>
                          <td className="text-[12px] text-gray-700">Falta de visibility/search de Order ID en BO para matching de withdrawals</td>
                          <td className="text-[12px] text-gray-700">Tema estructural recurrente</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Provider latency afectando withdrawals</td>
                          <td className="text-[13px] font-medium">FUN88</td>
                          <td className="text-[12px] text-gray-700">Withdrawals envejeciendo en `sent_to_provider` por delays STP + calendario bancario</td>
                          <td className="text-[12px] text-gray-700">13 wd pendientes = 9,163 MXN de 337 procesadas (weekend/holiday)</td>
                        </tr>
                        <tr>
                          <td className="text-[13px]">Fraud tuning para restaurar conversión</td>
                          <td className="text-[13px] font-medium">Vivento</td>
                          <td className="text-[12px] text-gray-700">Guardian creó alta fricción</td>
                          <td className="text-[12px] text-emerald-700 font-medium">Approval rate: 23% (Jan 4) → 65-75% tras apagar Guardian + tunear reglas</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 10.3 Executive Summary */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Executive Summary</h4>
                  <p className="text-gray-700 mb-2">
                    Q1 focus fue <strong>estabilidad operacional + reconciliation</strong>,
                    con patrones recurrentes en:
                  </p>
                  <ul className="text-gray-700 space-y-1 list-disc pl-5">
                    <li>Webhooks / callback correctness</li>
                    <li>Withdrawals state inconsistencies</li>
                    <li>Settlement timing expectations (T+1 / timezone)</li>
                    <li>Merchant confusion por IDs y reporting windows</li>
                  </ul>
                  <p className="text-gray-700 mt-2">
                    Velocidad de respuesta generalmente fuerte. Principal cost
                    driver fue <strong>complejidad sistémica</strong>, no SLA breaches.
                  </p>
                </div>

                {/* 10.4 Narrative — high impact */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Quarter Narrative · high-impact incidents</h4>
                  <div className="space-y-3">
                    <div>
                      <p className="font-semibold text-gray-900">PB-IDEM (Cards) — API 500 y backend/frontend mismatch</p>
                      <p className="text-gray-700">API 500 / upstream instability repetidos crearon escenario donde el merchant veía &ldquo;rejected&rdquo; mientras el backend seguía procesando. Riesgos: disputes/CB, pérdida de confianza, acciones de containment. Requirió escalación cross-team rápida.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">BC Game (Withdrawals) — duplicate callback / double payout risk</p>
                      <p className="text-gray-700">Duplicate callback behavior en withdrawals podía disparar accounting incorrecto. Respuesta requirió compensation actions y tightening de &ldquo;single final callback&rdquo; guarantees.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">Stadiobet — reconciliation + trust event</p>
                      <p className="text-gray-700">Reconciliation multi-día + clarificación repetida sobre settlement, wallet movements y reporting interpretation. Necesidad de standardized reconciliation artifact y clearer settlement education.</p>
                    </div>
                  </div>
                </div>

                {/* 10.5 KPI/SLA */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">KPI / SLA View</h4>
                  <p className="text-gray-700">
                    SLA fields en daily reports muestran <strong>First Response cerca de 3 min</strong> y{" "}
                    <strong>Resolution bajo 45 min</strong>, aunque algunos días aparecen como N/D.
                  </p>
                  <p className="text-gray-700 mt-1 italic">
                    Interpretación: support es responsive — las mayores mejoras vienen de{" "}
                    <strong>reducir clases de incidentes recurrentes</strong>, no de optimizar SLA puntual.
                  </p>
                </div>

                {/* 10.6 Recurring issues */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Recurring Issue Taxonomy</h4>
                  <ol className="text-gray-700 space-y-1.5 list-decimal pl-5">
                    <li><strong>Webhooks / callbacks:</strong> duplicates, delays, missing updates → &ldquo;success vs pending&rdquo; mismatches</li>
                    <li><strong>Withdrawals lifecycle + STP dependency:</strong> aging en `sent_to_provider`, provider latency + banking calendar</li>
                    <li><strong>Settlement + reconciliation + reporting windows:</strong> T+1 misunderstandings, timezone-based &ldquo;day shift&rdquo;</li>
                    <li><strong>Fraud / 3DS / approval rate:</strong> Guardian thresholds y false positives, confusión sobre responsibility boundaries</li>
                    <li><strong>&ldquo;Not found&rdquo; validations (not us vs us):</strong> SPEI tracking keys / receipts que no corresponden a cuentas Tonder</li>
                  </ol>
                </div>

                {/* 10.7 Cross-team */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Cross-Team Collaboration</h4>
                  <ul className="text-gray-700 space-y-1 list-disc pl-5">
                    <li><strong>FinOps:</strong> refunds, settlements, reconciliation, POPs, reporting automation</li>
                    <li><strong>Dev/Tech:</strong> callback correctness, idempotency/atomicity, exports, search/ID visibility, sandbox parity</li>
                    <li><strong>Product:</strong> docs y contract clarity (statuses/IDs), feature prioritization for support-driven gaps</li>
                  </ul>
                </div>

                {/* 10.8 Root causes */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Root-Cause Patterns</h4>
                  <ol className="text-gray-700 space-y-1.5 list-decimal pl-5">
                    <li><strong>State machine ambiguity</strong> — &ldquo;source of truth&rdquo; unclear (webhook vs query vs internal state)</li>
                    <li><strong>Idempotency + concurrency</strong> — duplicate events pueden crear riesgo financiero y reputacional</li>
                    <li><strong>Observability + retention gaps</strong> — short log retention incrementa time-to-resolution y empuja rework</li>
                    <li><strong>Documentation & enablement debt</strong> — tickets repetidos desde los mismos gaps conceptuales (timezone, IDs, settlement semantics)</li>
                  </ol>
                </div>

                {/* 10.9 Q2 recs */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">Recomendaciones para Q2</h4>
                  <div className="space-y-3">
                    <div className="border-l-4 border-violet-300 pl-3">
                      <p className="font-semibold text-gray-900">A · Reliability changes (highest ROI)</p>
                      <ul className="text-gray-700 space-y-1 list-disc pl-5 mt-1">
                        <li>Publicar <strong>source-of-truth contract</strong> claro por método, con expected eventual-consistency windows. <em>Enseñarle a Pascal.</em></li>
                        <li>Crear <strong>STP latency playbook:</strong> thresholds, comms template, escalation triggers. <em>Enseñarle a Pascal.</em></li>
                      </ul>
                    </div>
                    <div className="border-l-4 border-emerald-300 pl-3">
                      <p className="font-semibold text-gray-900">B · Proactive merchant enablement</p>
                      <p className="text-gray-700 mb-1">Short merchant guides para reducir repeat tickets:</p>
                      <ul className="text-gray-700 space-y-1 list-disc pl-5">
                        <li>&ldquo;How to validate a SPEI tracking key before escalating&rdquo;</li>
                        <li>&ldquo;Why <code className="font-mono text-xs">paid_in_full</code> may show next day (timezone)&rdquo;</li>
                        <li>&ldquo;How to correlate your IDs to Tonder IDs&rdquo;</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* 10.10 Notable patterns — already in §5 */}
                <p className="text-[12px] text-gray-500 italic pt-3 border-t border-gray-100">
                  El apéndice con patrones notables por merchant (BC Game, PB-IDEM,
                  Stadiobet, FUN88, Campobet) está integrado en §5 → &ldquo;Patrones
                  recurrentes observados&rdquo;.
                </p>
              </div>
            </CollapsibleCard>
          </section>

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

/**
 * Renders a person's name with live Slack/Telegram badges if the person
 * exists in pascal_people, or as plain gray text with an "(add to /people)"
 * nudge link if they don't. Used by the §8a feature-owners table and the
 * §17 SOPs catalog.
 */
function OwnerCell({ name, team }: { name: string; team: Person[] | null }) {
  const person = team?.find(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (!person) {
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[13px] text-gray-500">{name}</span>
        <Link
          href="/people?type=tonder_team"
          className="text-[10px] text-gray-400 hover:text-violet-600 underline-offset-2 hover:underline"
        >
          (add to /people)
        </Link>
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 flex-wrap">
      <span className="inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full self-center shrink-0" />
      <span className="text-[13px] text-gray-900 font-medium">{person.name}</span>
      {person.slack_user_id && (
        <code className="font-mono text-[10px] text-gray-600 bg-gray-50 px-1 py-0.5 rounded">
          {person.slack_user_id}
        </code>
      )}
      {person.telegram_user_id && (
        <code className="font-mono text-[10px] text-violet-700 bg-violet-50 px-1 py-0.5 rounded">
          tg:{person.telegram_user_id}
        </code>
      )}
    </span>
  );
}

/**
 * A `<details>`-based collapsible card that matches the .t-card aesthetic.
 * Used for the §1 Job Description and the §19 Q1 2026 QBR (both collapsed
 * by default so they don't dominate the page).
 */
function CollapsibleCard({
  eyebrow,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="t-card group" open={defaultOpen}>
      <summary className="cursor-pointer list-none flex items-baseline justify-between gap-3 -m-2 p-2 rounded-md hover:bg-gray-50 transition-colors">
        <div className="min-w-0">
          {eyebrow && (
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              {eyebrow}
            </p>
          )}
          <h3 className="text-base font-semibold text-gray-900 mt-0.5">{title}</h3>
          {subtitle && (
            <p className="text-[12px] text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        <span className="text-xs text-violet-600 font-medium shrink-0 group-open:hidden">
          Expandir ↓
        </span>
        <span className="text-xs text-gray-400 font-medium shrink-0 hidden group-open:inline">
          Colapsar ↑
        </span>
      </summary>
      <div className="mt-5 pt-5 border-t border-gray-100">{children}</div>
    </details>
  );
}
