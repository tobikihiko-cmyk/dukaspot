import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import htm from "htm";
import "./styles.css";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Copy,
  CreditCard,
  Download,
  FileSpreadsheet,
  Gauge,
  History,
  Import,
  Layers3,
  LineChart,
  MessageCircle,
  Package,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import {
  ORDER_STAGES,
  PAYMENT_CLASSES,
  buildReconciliation,
  dailyOwnerReport,
  deriveOrder,
  getAgentMetrics,
  getCustomerProfiles,
  getFollowUps,
  getInventoryRows,
  getSummary,
  money,
  normalizePhone,
  uid,
} from "@dukaspot/core";

const html = htm.bind(React.createElement);

const NAV_ITEMS = [
  { id: "dashboard", label: "Command", icon: Gauge, title: "Merchant command center" },
  { id: "reconcile", label: "Reconcile", icon: WalletCards, title: "M-PESA reconciliation" },
  { id: "orders", label: "Orders", icon: MessageCircle, title: "Conversation order ledger" },
  { id: "inventory", label: "Stock", icon: Package, title: "Inventory control" },
  { id: "customers", label: "Customers", icon: Users, title: "Customer intelligence" },
  { id: "agents", label: "Agents", icon: UserRoundCheck, title: "Agent performance" },
  { id: "reports", label: "Reports", icon: FileSpreadsheet, title: "Books and exports" },
];

const PRIMARY_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15";
const SECONDARY_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-300/35";
const GHOST_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-300/35";
const DANGER_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus:ring-4 focus:ring-rose-200/60";
const PANEL =
  "rounded-lg border border-slate-200 bg-white shadow-[0_24px_80px_rgba(17,24,39,.08)]";
const FIELD =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const TEXTAREA =
  "min-h-24 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10";
const LABEL = "grid gap-1.5 text-sm font-medium text-slate-700";

const DEFAULT_FILTERS = {
  orderSearch: "",
  orderStage: "all",
  customerSearch: "",
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const REQUEST_TIMEOUT_MS = 15_000;

function App() {
  const [activeView, setActiveView] = useHashView();
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);

  const notify = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 2600);
  };

  const ledger = useLedgerApi(notify);
  const state = ledger.state;

  const currentView = NAV_ITEMS.find((item) => item.id === activeView) || NAV_ITEMS[0];
  const summary = useMemo(() => (state ? getSummary(state) : null), [state]);
  const reconciliation = useMemo(
    () => (state ? buildReconciliation(state.orders, state.payments) : null),
    [state]
  );
  const derivedOrders = useMemo(
    () => (state ? state.orders.map((order) => deriveOrder(order, state.payments)) : []),
    [state]
  );
  const inventoryRows = useMemo(
    () =>
      state
        ? getInventoryRows(state.inventory, state.orders, state.payments)
        : [],
    [state]
  );
  const followUps = useMemo(
    () => (state ? getFollowUps(state.orders, state.payments) : []),
    [state]
  );

  const actions = {
    createOrder(order) {
      ledger.mutate("/orders", { method: "POST", body: order });
    },
    importPayments(csv) {
      ledger.mutate("/payments/import", { method: "POST", body: { csv } });
    },
    matchPayment(paymentId, orderId) {
      if (!paymentId || !orderId) {
        notify("Choose an order before matching");
        return;
      }
      ledger.mutate(`/payments/${encodeURIComponent(paymentId)}/match`, {
        method: "POST",
        body: { orderId },
      });
    },
    classifyPayment(paymentId, classification) {
      ledger.mutate(`/payments/${encodeURIComponent(paymentId)}/classify`, {
        method: "POST",
        body: { classification },
      });
    },
    unmatchPayment(paymentId) {
      ledger.mutate(`/payments/${encodeURIComponent(paymentId)}/unmatch`, {
        method: "POST",
      });
    },
    updateOrderStage(orderId, stage) {
      ledger.mutate(`/orders/${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        body: { stage },
      });
    },
    updatePaymentClass(paymentId, classification) {
      ledger.mutate(`/payments/${encodeURIComponent(paymentId)}/classify`, {
        method: "POST",
        body: { classification },
      });
    },
    markFollowUp(orderId) {
      ledger.mutate(`/orders/${encodeURIComponent(orderId)}/follow-up`, {
        method: "POST",
      });
    },
    restockItem(itemId, quantity) {
      ledger.mutate(`/inventory/${encodeURIComponent(itemId)}/restock`, {
        method: "POST",
        body: { quantity },
      });
    },
    createInventoryItem(item) {
      ledger.mutate("/inventory", { method: "POST", body: item });
    },
    resetDemo() {
      const confirmed = window.confirm("Reset Dukaspot demo data?");
      if (!confirmed) return;
      ledger.mutate("/demo/reset", { method: "POST" });
    },
    copyReport() {
      navigator.clipboard
        ?.writeText(dailyOwnerReport(state))
        .then(() => notify("Owner report copied"))
        .catch(() => notify("Clipboard unavailable"));
    },
    downloadReport() {
      downloadFromApi("/reports/daily", "dukaspot-owner-report.txt", notify);
    },
    downloadOrders() {
      downloadFromApi("/exports/orders.csv", "dukaspot-orders.csv", notify);
    },
    downloadPayments() {
      downloadFromApi("/exports/payments.csv", "dukaspot-payments.csv", notify);
    },
  };

  if (ledger.loading && !state) {
    return html`<${LoadingScreen} />`;
  }

  if (ledger.error && !state) {
    return html`<${ErrorScreen} error=${ledger.error} onRetry=${ledger.refresh} />`;
  }

  const viewProps = {
    state,
    summary,
    reconciliation,
    derivedOrders,
    inventoryRows,
    followUps,
    filters,
    setFilters,
    actions,
  };

  return html`
    <div className="min-h-screen bg-[#f5f7f6] text-slate-950 antialiased">
      <${AppShell}
        state=${state}
        activeView=${activeView}
        currentView=${currentView}
        onNavigate=${setActiveView}
      >
        <${ViewRouter} activeView=${activeView} ...${viewProps} />
      <//>
      <${Toast} message=${toast} />
    </div>
  `;
}

function AppShell({ state, activeView, currentView, onNavigate, children }) {
  return html`
    <div className="grid min-h-screen lg:grid-cols-[296px_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-[#07110f] text-white lg:border-b-0 lg:border-r lg:border-r-black/10">
        <div className="sticky top-0 flex min-h-full flex-col gap-6 p-4 lg:h-screen lg:p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-emerald-300/25 bg-emerald-400/10 text-sm font-black text-emerald-100">
              DS
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold tracking-normal">Dukaspot</p>
              <p className="truncate text-sm text-slate-400">Kenya commerce records</p>
            </div>
          </div>

          <nav className="scrollbar-none flex gap-2 overflow-x-auto lg:grid lg:overflow-visible" aria-label="Primary">
            ${NAV_ITEMS.map(
              (item) => html`
                <${NavItem}
                  key=${item.id}
                  item=${item}
                  active=${activeView === item.id}
                  onClick=${() => onNavigate(item.id)}
                />
              `
            )}
          </nav>

          <div className="mt-auto grid gap-3 rounded-lg border border-white/10 bg-white/[0.045] p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Merchant
              </span>
              <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-xs font-semibold text-emerald-100">
                Pilot
              </span>
            </div>
            <div>
              <p className="font-semibold">${state.merchant.name}</p>
              <p className="mt-1 text-sm text-slate-400">${state.merchant.till}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-slate-500">Segment</p>
                <p className="mt-1 font-semibold text-slate-200">${state.merchant.segment}</p>
              </div>
              <div className="rounded-lg bg-black/20 p-3">
                <p className="text-slate-500">Ledger</p>
                <p className="mt-1 font-semibold text-slate-200">Local</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/86 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
                WhatsApp-to-books OS
              </p>
              <h1 className="mt-2 max-w-full break-words text-xl font-black leading-tight tracking-normal text-slate-950 sm:text-3xl">
                ${currentView.title}
              </h1>
            </div>
            <div className="grid max-w-full gap-2 text-sm sm:flex sm:flex-wrap sm:items-center">
              <span className="inline-flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-600 shadow-sm sm:w-auto">
                <${Clock3} className="h-4 w-4 text-slate-400" />
                Updated ${formatDateTime(state.updatedAt)}
              </span>
              <span className="inline-flex w-full max-w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800 sm:w-auto">
                <${ShieldCheck} className="h-4 w-4 shrink-0" />
                <span className="truncate">Human-confirmed ledger</span>
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-[1680px] gap-5 px-4 py-5 sm:px-6 lg:px-8">
          ${children}
        </div>
      </main>
    </div>
  `;
}

function NavItem({ item, active, onClick }) {
  const Icon = item.icon;
  return html`
    <button
      type="button"
      onClick=${onClick}
      className=${[
        "group flex h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition",
        active
          ? "bg-white text-slate-950 shadow-sm"
          : "text-slate-400 hover:bg-white/8 hover:text-white",
      ].join(" ")}
    >
      <${Icon}
        className=${[
          "h-4 w-4",
          active ? "text-emerald-700" : "text-slate-500 group-hover:text-emerald-200",
        ].join(" ")}
      />
      <span>${item.label}</span>
    </button>
  `;
}

function ViewRouter(props) {
  const viewMap = {
    dashboard: DashboardView,
    reconcile: ReconcileView,
    orders: OrdersView,
    inventory: InventoryView,
    customers: CustomersView,
    agents: AgentsView,
    reports: ReportsView,
  };
  const View = viewMap[props.activeView] || DashboardView;
  return html`<${View} ...${props} />`;
}

function DashboardView({
  state,
  summary,
  reconciliation,
  inventoryRows,
  followUps,
  actions,
}) {
  const lowStock = inventoryRows.filter((item) => item.lowStock).slice(0, 5);
  const ownerReport = dailyOwnerReport(state);

  return html`
    <${React.Fragment}>
    <${MetricGrid} summary=${summary} />

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,.9fr)]">
      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Capture"
          title="New social order"
          icon=${MessageCircle}
          meta="Under 60 seconds"
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${OrderForm} state=${state} onCreate=${actions.createOrder} />
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Owner close"
          title="Daily control memo"
          icon=${ReceiptText}
          action=${html`
            <button className=${GHOST_BUTTON} type="button" onClick=${actions.copyReport}>
              <${Copy} className="h-4 w-4" /> Copy
            </button>
          `}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <pre className="min-h-[318px] overflow-auto rounded-lg bg-[#07110f] p-5 font-mono text-sm leading-6 text-emerald-50 shadow-inner">
${ownerReport}</pre
          >
        </div>
      </div>
    </section>

    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(390px,.72fr)]">
      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="M-PESA"
          title="Highest-impact review queue"
          icon=${CreditCard}
          action=${html`
            <button className=${GHOST_BUTTON} type="button" onClick=${() => setHash("reconcile")}>
              Open queue <${ChevronRight} className="h-4 w-4" />
            </button>
          `}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${PaymentQueue}
            state=${state}
            reconciliation=${reconciliation}
            actions=${actions}
            limit=${4}
          />
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Recover"
          title="Unpaid conversations"
          icon=${RefreshCw}
          meta=${`${followUps.length} due`}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${FollowUpList} followUps=${followUps.slice(0, 5)} onFollowUp=${actions.markFollowUp} />
        </div>
      </div>
    </section>

    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Stock"
        title="Inventory pressure"
        icon=${Package}
        meta=${`${lowStock.length} alerts`}
      />
      <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2 sm:px-5 sm:pb-5 xl:grid-cols-5">
        ${lowStock.length
          ? lowStock.map((item) => html`<${StockSignal} key=${item.id} item=${item} />`)
          : html`<${EmptyState} message="No stock alerts. Inventory has room to breathe." />`}
      </div>
    </section>
    <//>
  `;
}

function MetricGrid({ summary }) {
  const metrics = [
    {
      label: "Today enquiries",
      value: summary.enquiries,
      detail: "New price or delivery conversations",
      icon: MessageCircle,
      tone: "emerald",
    },
    {
      label: "Confirmed",
      value: summary.confirmedOrders,
      detail: "Orders created today",
      icon: ClipboardCheck,
      tone: "blue",
    },
    {
      label: "Paid orders",
      value: summary.paidOrders,
      detail: "Cleared balances in ledger",
      icon: Check,
      tone: "emerald",
    },
    {
      label: "Collected",
      value: money(summary.collected),
      detail: "Business cash received today",
      icon: WalletCards,
      tone: "slate",
    },
    {
      label: "Unmatched",
      value: money(summary.unmatched),
      detail: "Payments waiting for review",
      icon: AlertTriangle,
      tone: "amber",
    },
    {
      label: "Unpaid reservations",
      value: money(summary.unpaidReservations),
      detail: "Open order balances",
      icon: Clock3,
      tone: "rose",
    },
    {
      label: "Gross profit",
      value: money(summary.grossProfit),
      detail: "Estimated from known costs",
      icon: LineChart,
      tone: "blue",
    },
    {
      label: "Follow-ups",
      value: summary.followUps,
      detail: "Customers to recover",
      icon: Activity,
      tone: "slate",
    },
  ];

  return html`
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      ${metrics.map((metric) => html`<${MetricCard} key=${metric.label} metric=${metric} />`)}
    </section>
  `;
}

function MetricCard({ metric }) {
  const Icon = metric.icon;
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };

  return html`
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_18px_50px_rgba(17,24,39,.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            ${metric.label}
          </p>
          <p className="mt-3 text-2xl font-black tracking-normal text-slate-950">
            ${metric.value}
          </p>
        </div>
        <span className=${`grid h-10 w-10 place-items-center rounded-lg ring-1 ${tones[metric.tone]}`}>
          <${Icon} className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-sm leading-5 text-slate-600">${metric.detail}</p>
    </article>
  `;
}

function ReconcileView({ state, reconciliation, actions }) {
  return html`
    <${React.Fragment}>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Import"
          title="M-PESA statement intake"
          icon=${Import}
          meta="CSV first, Daraja later"
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${PaymentImportForm} onImport=${actions.importPayments} />
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Control"
          title="Reconciliation health"
          icon=${Gauge}
          meta="Owner visible"
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${ReconciliationHealth} state=${state} reconciliation=${reconciliation} />
        </div>
      </div>
    </section>

    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Review desk"
        title="Unmatched payments"
        icon=${WalletCards}
        meta=${`${reconciliation.unmatchedPayments.length} open`}
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <${PaymentQueue} state=${state} reconciliation=${reconciliation} actions=${actions} />
      </div>
    </section>

    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Posted"
        title="Matched payment ledger"
        icon=${ReceiptText}
        meta=${`${reconciliation.matchedPayments.length} matched`}
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <${MatchedPayments} state=${state} actions=${actions} />
      </div>
    </section>
    <//>
  `;
}

function OrdersView({ state, derivedOrders, filters, setFilters, actions }) {
  const filtered = derivedOrders
    .filter((order) => {
      const query = filters.orderSearch.toLowerCase();
      const matchesStage = filters.orderStage === "all" || order.stage === filters.orderStage;
      const haystack = [
        order.customerName,
        order.phone,
        order.productName,
        order.variant,
        order.agent,
      ]
        .join(" ")
        .toLowerCase();
      return matchesStage && (!query || haystack.includes(query));
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return html`
    <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className=${PANEL}>
        <${PanelHeader} eyebrow="Capture" title="Order intake" icon=${MessageCircle} />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${OrderForm} state=${state} onCreate=${actions.createOrder} />
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Ledger"
          title="Orders requiring operational truth"
          icon=${Layers3}
          meta=${`${filtered.length} records`}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <${SearchBox}
              value=${filters.orderSearch}
              placeholder="Search customer, product, phone"
              onChange=${(value) => setFilters((current) => ({ ...current, orderSearch: value }))}
            />
            <select
              className=${`${FIELD} md:max-w-48`}
              value=${filters.orderStage}
              onChange=${(event) =>
                setFilters((current) => ({ ...current, orderStage: event.target.value }))}
              aria-label="Order stage"
            >
              ${["all", ...ORDER_STAGES].map(
                (stage) => html`<option key=${stage} value=${stage}>${titleCase(stage)}</option>`
              )}
            </select>
          </div>
          <${OrdersTable} orders=${filtered} actions=${actions} />
        </div>
      </div>
    </section>
  `;
}

function InventoryView({ inventoryRows, actions }) {
  return html`
    <section className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
      <div className=${PANEL}>
        <${PanelHeader} eyebrow="Catalogue" title="Add stock item" icon=${Package} />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${InventoryForm} onCreate=${actions.createInventoryItem} />
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Inventory"
          title="Available, reserved, sold"
          icon=${Layers3}
          meta=${`${inventoryRows.length} SKUs`}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <${InventoryTable} rows=${inventoryRows} onRestock=${actions.restockItem} />
        </div>
      </div>
    </section>
  `;
}

function CustomersView({ state, filters, setFilters }) {
  const query = filters.customerSearch.toLowerCase();
  const profiles = getCustomerProfiles(state.orders, state.payments).filter(
    (profile) =>
      !query ||
      profile.name.toLowerCase().includes(query) ||
      profile.phone.includes(query) ||
      profile.preferredProduct.toLowerCase().includes(query)
  );

  return html`
    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Customer memory"
        title="Repeat buyer profiles"
        icon=${Users}
        meta=${`${profiles.length} profiles`}
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <div className="mb-4">
          <${SearchBox}
            value=${filters.customerSearch}
            placeholder="Search customers, phone, product"
            onChange=${(value) => setFilters((current) => ({ ...current, customerSearch: value }))}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          ${profiles.length
            ? profiles.map((profile) => html`<${CustomerCard} key=${profile.id} profile=${profile} />`)
            : html`<${EmptyState} message="No matching customer records." />`}
        </div>
      </div>
    </section>
  `;
}

function AgentsView({ state }) {
  const agents = getAgentMetrics(state.orders, state.payments);
  const maxSales = Math.max(...agents.map((agent) => agent.salesValue), 1);

  return html`
    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Sales desk"
        title="Agent conversion and exceptions"
        icon=${UserRoundCheck}
        meta=${`${agents.length} active`}
      />
      <div className="grid gap-3 px-4 pb-4 sm:px-5 sm:pb-5 lg:grid-cols-2 2xl:grid-cols-3">
        ${agents.map(
          (agent) => html`
            <${AgentCard} key=${agent.agent} agent=${agent} maxSales=${maxSales} />
          `
        )}
      </div>
    </section>
  `;
}

function ReportsView({ state, actions }) {
  const ownerReport = dailyOwnerReport(state);
  const derivedOrders = state.orders.map((order) => deriveOrder(order, state.payments));
  const paidRevenue = derivedOrders.reduce(
    (sum, order) => sum + Math.min(order.total, order.paidAmount),
    0
  );
  const cogs = derivedOrders
    .filter((order) => order.computedPaymentStatus === "paid")
    .reduce((sum, order) => sum + (Number(order.quantity) || 0) * (Number(order.unitCost) || 0), 0);
  const outstanding = derivedOrders.reduce((sum, order) => sum + order.balance, 0);
  const delivery = derivedOrders
    .filter((order) => order.computedPaymentStatus === "paid")
    .reduce((sum, order) => sum + (Number(order.deliveryFee) || 0), 0);

  return html`
    <${React.Fragment}>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className=${PANEL}>
        <${PanelHeader}
          eyebrow="Owner"
          title="Daily close report"
          icon=${ReceiptText}
          action=${html`
            <button className=${SECONDARY_BUTTON} type="button" onClick=${actions.downloadReport}>
              <${Download} className="h-4 w-4" /> Download
            </button>
          `}
        />
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <pre className="overflow-auto rounded-lg bg-[#07110f] p-5 font-mono text-sm leading-6 text-emerald-50 shadow-inner">
${ownerReport}</pre
          >
        </div>
      </div>

      <div className=${PANEL}>
        <${PanelHeader} eyebrow="Books" title="Accountant pack" icon=${FileSpreadsheet} />
        <div className="grid gap-4 px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="grid gap-2">
            <button className=${PRIMARY_BUTTON} type="button" onClick=${actions.downloadOrders}>
              <${ArrowDownToLine} className="h-4 w-4" /> Export order ledger
            </button>
            <button className=${SECONDARY_BUTTON} type="button" onClick=${actions.downloadPayments}>
              <${Download} className="h-4 w-4" /> Export payment ledger
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <${BookValue} label="Revenue" value=${money(paidRevenue)} />
            <${BookValue} label="COGS" value=${money(cogs)} />
            <${BookValue} label="Delivery" value=${money(delivery)} />
            <${BookValue} label="Outstanding" value=${money(outstanding)} />
          </div>
        </div>
      </div>
    </section>

    <section className=${PANEL}>
      <${PanelHeader}
        eyebrow="Governance"
        title="Audit trail"
        icon=${History}
        action=${html`
          <button className=${DANGER_BUTTON} type="button" onClick=${actions.resetDemo}>
            <${RotateCcw} className="h-4 w-4" /> Reset demo
          </button>
        `}
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        <${AuditTrail} logs=${state.auditLog || []} />
      </div>
    </section>
    <//>
  `;
}

function PanelHeader({ eyebrow, title, icon: Icon, meta, action }) {
  return html`
    <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-slate-100 px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700 ring-1 ring-slate-200">
          <${Icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            ${eyebrow}
          </p>
          <h2 className="mt-1 truncate text-base font-black tracking-normal text-slate-950">
            ${title}
          </h2>
        </div>
      </div>
      ${action ||
      (meta &&
        html`<span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          ${meta}
        </span>`)}
    </div>
  `;
}

function OrderForm({ state, onCreate }) {
  const emptyDraft = {
    customerName: "",
    phone: "",
    productName: "",
    variant: "",
    quantity: 1,
    unitPrice: 0,
    unitCost: 0,
    deliveryFee: 0,
    discount: 0,
    location: "",
    source: "WhatsApp",
    agent: state.agents[0] || "Owner",
    stage: "confirmed",
    notes: "",
  };
  const [draft, setDraft] = useState(emptyDraft);

  const setField = (field, value) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "productName") {
        const product = state.inventory.find(
          (item) => item.productName.toLowerCase() === String(value).toLowerCase()
        );
        if (product) {
          next.variant = current.variant || product.variant;
          next.unitPrice = Number(current.unitPrice) ? current.unitPrice : product.sellingPrice;
          next.unitCost = Number(current.unitCost) ? current.unitCost : product.unitCost;
        }
      }
      return next;
    });
  };

  const submit = (event) => {
    event.preventDefault();
    onCreate({
      id: uid("ord"),
      createdAt: new Date().toISOString(),
      customerName: draft.customerName.trim(),
      phone: normalizePhone(draft.phone),
      productName: draft.productName.trim(),
      variant: draft.variant.trim(),
      quantity: Number(draft.quantity) || 1,
      unitPrice: Number(draft.unitPrice) || 0,
      unitCost: Number(draft.unitCost) || 0,
      deliveryFee: Number(draft.deliveryFee) || 0,
      discount: Number(draft.discount) || 0,
      location: draft.location.trim(),
      source: draft.source,
      agent: draft.agent.trim() || "Unassigned",
      stage: draft.stage,
      paymentStatus: "unpaid",
      notes: draft.notes.trim(),
      lastFollowUpAt: "",
    });
    setDraft(emptyDraft);
  };

  return html`
    <form className="grid gap-4" onSubmit=${submit}>
      <datalist id="product-options">
        ${state.inventory.map(
          (item) => html`
            <option
              key=${item.id}
              value=${item.productName}
              label=${`${item.variant} - ${money(item.sellingPrice)}`}
            />
          `
        )}
      </datalist>
      <datalist id="agent-options">
        ${state.agents.map((agent) => html`<option key=${agent} value=${agent} />`)}
      </datalist>

      <div className="grid gap-3 md:grid-cols-2">
        <${TextField}
          label="Customer"
          value=${draft.customerName}
          onChange=${(value) => setField("customerName", value)}
          placeholder="Jane Njeri"
          required=${true}
        />
        <${TextField}
          label="Phone"
          value=${draft.phone}
          onChange=${(value) => setField("phone", value)}
          placeholder="0712345678"
          required=${true}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <${TextField}
          label="Product"
          value=${draft.productName}
          onChange=${(value) => setField("productName", value)}
          placeholder="Denim midi dress"
          list="product-options"
          required=${true}
        />
        <${TextField}
          label="Variant"
          value=${draft.variant}
          onChange=${(value) => setField("variant", value)}
          placeholder="Black M"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <${NumberField} label="Qty" value=${draft.quantity} min="1" onChange=${(value) => setField("quantity", value)} />
        <${NumberField} label="Price" value=${draft.unitPrice} onChange=${(value) => setField("unitPrice", value)} />
        <${NumberField} label="Cost" value=${draft.unitCost} onChange=${(value) => setField("unitCost", value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <${NumberField} label="Delivery" value=${draft.deliveryFee} onChange=${(value) => setField("deliveryFee", value)} />
        <${NumberField} label="Discount" value=${draft.discount} onChange=${(value) => setField("discount", value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <${TextField} label="Location" value=${draft.location} onChange=${(value) => setField("location", value)} placeholder="Kilimani" />
        <${SelectField}
          label="Source"
          value=${draft.source}
          onChange=${(value) => setField("source", value)}
          options=${["WhatsApp", "Instagram", "TikTok", "Referral", "Walk-in"]}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <${TextField}
          label="Agent"
          value=${draft.agent}
          onChange=${(value) => setField("agent", value)}
          list="agent-options"
          required=${true}
        />
        <${SelectField}
          label="Stage"
          value=${draft.stage}
          onChange=${(value) => setField("stage", value)}
          options=${ORDER_STAGES.filter((stage) => stage !== "returned")}
          formatter=${titleCase}
        />
      </div>
      <label className=${LABEL}>
        Notes
        <textarea
          className=${TEXTAREA}
          value=${draft.notes}
          onChange=${(event) => setField("notes", event.target.value)}
          placeholder="Delivery promise, colour choice, deposit note"
        />
      </label>
      <div className="flex justify-end">
        <button className=${PRIMARY_BUTTON} type="submit">
          <${ClipboardCheck} className="h-4 w-4" /> Capture order
        </button>
      </div>
    </form>
  `;
}

function PaymentImportForm({ onImport }) {
  const [csv, setCsv] = useState("");

  const submit = (event) => {
    event.preventDefault();
    onImport(csv);
    setCsv("");
  };

  const loadSample = () => setCsv(sampleCsv());

  const readFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result || ""));
    reader.readAsText(file);
  };

  return html`
    <form className="grid gap-4" onSubmit=${submit}>
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <label className=${LABEL}>
          CSV file
          <input className=${FIELD} type="file" accept=".csv,text/csv" onChange=${readFile} />
        </label>
        <div className="flex items-end">
          <button className=${SECONDARY_BUTTON} type="button" onClick=${loadSample}>
            <${Import} className="h-4 w-4" /> Load sample
          </button>
        </div>
      </div>
      <label className=${LABEL}>
        M-PESA rows
        <textarea
          className=${`${TEXTAREA} min-h-[210px] font-mono text-xs leading-5`}
          value=${csv}
          onChange=${(event) => setCsv(event.target.value)}
          placeholder="Date,Receipt,Payer,Phone,Paid In,Details"
        />
      </label>
      <div className="flex justify-end">
        <button className=${PRIMARY_BUTTON} type="submit">
          <${WalletCards} className="h-4 w-4" /> Import transactions
        </button>
      </div>
    </form>
  `;
}

function PaymentQueue({ state, reconciliation, actions, limit = 100 }) {
  const payments = reconciliation.unmatchedPayments.slice(0, limit);
  if (!payments.length) return html`<${EmptyState} message="No unmatched payments. The queue is clean." />`;

  const orderOptions = state.orders
    .filter((order) => !["cancelled", "returned"].includes(order.stage))
    .map((order) => deriveOrder(order, state.payments));

  return html`
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <th className="border-b border-slate-200 py-3 pr-4">Receipt</th>
            <th className="border-b border-slate-200 px-4 py-3">Payer</th>
            <th className="border-b border-slate-200 px-4 py-3">Amount</th>
            <th className="border-b border-slate-200 px-4 py-3">Suggested match</th>
            <th className="border-b border-slate-200 py-3 pl-4">Decision</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          ${payments.map((payment) => {
            const candidates = reconciliation.suggestions[payment.id] || [];
            const best = candidates[0];
            return html`
              <${PaymentReviewRow}
                key=${payment.id}
                payment=${payment}
                best=${best}
                orderOptions=${orderOptions}
                actions=${actions}
              />
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function PaymentReviewRow({ payment, best, orderOptions, actions }) {
  const [manualOrderId, setManualOrderId] = useState("");
  const selectedOrder = manualOrderId || best?.orderId || "";

  return html`
    <tr className="align-top">
      <td className="py-4 pr-4">
        <p className="font-black text-slate-950">${payment.receipt}</p>
        <p className="mt-1 text-xs text-slate-500">${formatDateTime(payment.receivedAt)}</p>
      </td>
      <td className="px-4 py-4">
        <p className="font-semibold text-slate-900">${payment.payerName || "Unknown payer"}</p>
        <p className="mt-1 text-xs text-slate-500">${payment.phone || payment.details || "No phone"}</p>
      </td>
      <td className="px-4 py-4 font-black text-slate-950">${money(payment.amount)}</td>
      <td className="px-4 py-4">
        ${best
          ? html`
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-950">
                    ${best.order.customerName} · ${best.order.productName}
                  </p>
                  <${Badge}
                    tone=${best.score >= 80 ? "green" : "amber"}
                    label=${`${best.score}% ${best.confidence}`}
                  />
                </div>
                <p className="text-xs text-slate-500">${best.reasons.join(", ")}</p>
              </div>
            `
          : html`<p className="text-sm font-medium text-slate-500">Needs manual review</p>`}
        <select
          className=${`${FIELD} mt-3`}
          value=${manualOrderId}
          onChange=${(event) => setManualOrderId(event.target.value)}
          aria-label="Manual order"
        >
          <option value="">Use suggested or choose order</option>
          ${orderOptions.map(
            (order) => html`
              <option key=${order.id} value=${order.id}>
                ${order.customerName} · ${order.productName} · ${money(order.balance)} due
              </option>
            `
          )}
        </select>
      </td>
      <td className="py-4 pl-4">
        <div className="flex flex-wrap gap-2">
          <button className=${PRIMARY_BUTTON} type="button" onClick=${() => actions.matchPayment(payment.id, selectedOrder)}>
            <${Check} className="h-4 w-4" /> Match
          </button>
          <button
            className=${SECONDARY_BUTTON}
            type="button"
            onClick=${() => actions.classifyPayment(payment.id, "owner_deposit")}
          >
            Owner
          </button>
          <button
            className=${SECONDARY_BUTTON}
            type="button"
            onClick=${() => actions.classifyPayment(payment.id, "personal_transfer")}
          >
            Personal
          </button>
        </div>
      </td>
    </tr>
  `;
}

function MatchedPayments({ state, actions }) {
  const payments = state.payments
    .filter((payment) => payment.orderId)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

  if (!payments.length) return html`<${EmptyState} message="No matched payments yet." />`;

  return html`
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <th className="border-b border-slate-200 py-3 pr-4">Receipt</th>
            <th className="border-b border-slate-200 px-4 py-3">Order</th>
            <th className="border-b border-slate-200 px-4 py-3">Class</th>
            <th className="border-b border-slate-200 px-4 py-3">Amount</th>
            <th className="border-b border-slate-200 py-3 pl-4"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          ${payments.map((payment) => {
            const order = state.orders.find((entry) => entry.id === payment.orderId);
            return html`
              <tr key=${payment.id}>
                <td className="py-4 pr-4">
                  <p className="font-black text-slate-950">${payment.receipt}</p>
                  <p className="mt-1 text-xs text-slate-500">${formatDateTime(payment.receivedAt)}</p>
                </td>
                <td className="px-4 py-4 font-medium text-slate-800">
                  ${order ? `${order.customerName} · ${order.productName}` : "Missing order"}
                </td>
                <td className="px-4 py-4">
                  <select
                    className=${FIELD}
                    value=${payment.classification}
                    onChange=${(event) => actions.updatePaymentClass(payment.id, event.target.value)}
                  >
                    ${PAYMENT_CLASSES.map(
                      (classification) => html`
                        <option key=${classification} value=${classification}>
                          ${titleCase(classification)}
                        </option>
                      `
                    )}
                  </select>
                </td>
                <td className="px-4 py-4 font-black">${money(payment.amount)}</td>
                <td className="py-4 pl-4 text-right">
                  <button className=${GHOST_BUTTON} type="button" onClick=${() => actions.unmatchPayment(payment.id)}>
                    Unmatch
                  </button>
                </td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function ReconciliationHealth({ state, reconciliation }) {
  const totalPayments = state.payments.filter((payment) => payment.amount > 0).length;
  const matched = reconciliation.matchedPayments.length;
  const classified = state.payments.filter(
    (payment) => !payment.orderId && payment.status === "classified"
  ).length;
  const matchRate = totalPayments ? Math.round((matched / totalPayments) * 100) : 0;

  const items = [
    ["Match rate", `${matchRate}%`],
    ["Matched", matched],
    ["Review", reconciliation.unmatchedPayments.length],
    ["Classified", classified],
  ];

  return html`
    <${React.Fragment}>
    <div className="grid gap-3 sm:grid-cols-2">
      ${items.map(
        ([label, value]) => html`
          <div key=${label} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">${label}</p>
            <p className="mt-2 text-2xl font-black tracking-normal">${value}</p>
          </div>
        `
      )}
    </div>
    <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-emerald-700" style=${{ width: `${matchRate}%` }}></div>
    </div>
    <p className="mt-4 text-sm leading-6 text-slate-600">
      The engine can recommend matches, but books are only posted after the operator confirms or classifies each payment.
    </p>
    <//>
  `;
}

function FollowUpList({ followUps, onFollowUp }) {
  if (!followUps.length) return html`<${EmptyState} message="No follow-ups due." />`;

  return html`
    <div className="divide-y divide-slate-100">
      ${followUps.map(
        (order) => html`
          <div key=${order.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-black text-slate-950">${order.customerName}</p>
              <p className="mt-1 text-sm text-slate-600">
                ${order.productName} · ${money(order.balance)} due
              </p>
              <p className="mt-1 text-xs text-slate-500">
                ${order.phone} · ${order.agent} · ${relativeAge(order.createdAt)}
              </p>
            </div>
            <button className=${SECONDARY_BUTTON} type="button" onClick=${() => onFollowUp(order.id)}>
              <${RefreshCw} className="h-4 w-4" /> Followed up
            </button>
          </div>
        `
      )}
    </div>
  `;
}

function OrdersTable({ orders, actions }) {
  if (!orders.length) return html`<${EmptyState} message="No matching orders." />`;

  return html`
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <th className="border-b border-slate-200 py-3 pr-4">Customer</th>
            <th className="border-b border-slate-200 px-4 py-3">Item</th>
            <th className="border-b border-slate-200 px-4 py-3">Balance</th>
            <th className="border-b border-slate-200 px-4 py-3">Payment</th>
            <th className="border-b border-slate-200 px-4 py-3">Stage</th>
            <th className="border-b border-slate-200 px-4 py-3">Agent</th>
            <th className="border-b border-slate-200 py-3 pl-4"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          ${orders.map(
            (order) => html`
              <tr key=${order.id}>
                <td className="py-4 pr-4">
                  <p className="font-black text-slate-950">${order.customerName}</p>
                  <p className="mt-1 text-xs text-slate-500">${order.phone} · ${formatDateTime(order.createdAt)}</p>
                </td>
                <td className="px-4 py-4">
                  <p className="font-semibold">${order.productName}</p>
                  <p className="mt-1 text-xs text-slate-500">${order.variant || "Default"} · ${order.quantity} pcs</p>
                </td>
                <td className="px-4 py-4 font-black">${money(order.balance)}</td>
                <td className="px-4 py-4">
                  <${Badge}
                    tone=${order.computedPaymentStatus === "paid"
                      ? "green"
                      : order.computedPaymentStatus === "partial"
                        ? "amber"
                        : "slate"}
                    label=${titleCase(order.computedPaymentStatus)}
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    ${money(order.paidAmount)} / ${money(order.total)}
                  </p>
                </td>
                <td className="px-4 py-4">
                  <select
                    className=${FIELD}
                    value=${order.stage}
                    onChange=${(event) => actions.updateOrderStage(order.id, event.target.value)}
                  >
                    ${ORDER_STAGES.map(
                      (stage) => html`<option key=${stage} value=${stage}>${titleCase(stage)}</option>`
                    )}
                  </select>
                </td>
                <td className="px-4 py-4 font-semibold">${order.agent}</td>
                <td className="py-4 pl-4 text-right">
                  <button className=${GHOST_BUTTON} type="button" onClick=${() => actions.markFollowUp(order.id)}>
                    Follow-up
                  </button>
                </td>
              </tr>
            `
          )}
        </tbody>
      </table>
    </div>
  `;
}

function InventoryForm({ onCreate }) {
  const [draft, setDraft] = useState({
    sku: "",
    productName: "",
    variant: "",
    onHand: 1,
    reorderPoint: 3,
    unitCost: 0,
    sellingPrice: 0,
  });

  const setField = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  const submit = (event) => {
    event.preventDefault();
    onCreate({
      id: uid("sku"),
      sku: draft.sku.trim(),
      productName: draft.productName.trim(),
      variant: draft.variant.trim(),
      onHand: Number(draft.onHand) || 0,
      reorderPoint: Number(draft.reorderPoint) || 0,
      unitCost: Number(draft.unitCost) || 0,
      sellingPrice: Number(draft.sellingPrice) || 0,
    });
    setDraft({
      sku: "",
      productName: "",
      variant: "",
      onHand: 1,
      reorderPoint: 3,
      unitCost: 0,
      sellingPrice: 0,
    });
  };

  return html`
    <form className="grid gap-4" onSubmit=${submit}>
      <${TextField} label="SKU" value=${draft.sku} onChange=${(value) => setField("sku", value)} placeholder="DRS-BLK-M" required=${true} />
      <${TextField} label="Product" value=${draft.productName} onChange=${(value) => setField("productName", value)} placeholder="Denim midi dress" required=${true} />
      <${TextField} label="Variant" value=${draft.variant} onChange=${(value) => setField("variant", value)} placeholder="Black M" />
      <div className="grid gap-3 md:grid-cols-2">
        <${NumberField} label="On hand" value=${draft.onHand} onChange=${(value) => setField("onHand", value)} />
        <${NumberField} label="Reorder point" value=${draft.reorderPoint} onChange=${(value) => setField("reorderPoint", value)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <${NumberField} label="Unit cost" value=${draft.unitCost} onChange=${(value) => setField("unitCost", value)} />
        <${NumberField} label="Selling price" value=${draft.sellingPrice} onChange=${(value) => setField("sellingPrice", value)} />
      </div>
      <button className=${PRIMARY_BUTTON} type="submit">
        <${Package} className="h-4 w-4" /> Add item
      </button>
    </form>
  `;
}

function InventoryTable({ rows, onRestock }) {
  if (!rows.length) return html`<${EmptyState} message="No catalogue items." />`;

  return html`
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <th className="border-b border-slate-200 py-3 pr-4">SKU</th>
            <th className="border-b border-slate-200 px-4 py-3">Product</th>
            <th className="border-b border-slate-200 px-4 py-3">Available</th>
            <th className="border-b border-slate-200 px-4 py-3">Reserved</th>
            <th className="border-b border-slate-200 px-4 py-3">Sold</th>
            <th className="border-b border-slate-200 px-4 py-3">Margin</th>
            <th className="border-b border-slate-200 py-3 pl-4"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          ${rows.map(
            (item) => html`
              <tr key=${item.id}>
                <td className="py-4 pr-4 font-black">${item.sku}</td>
                <td className="px-4 py-4">
                  <p className="font-semibold">${item.productName}</p>
                  <p className="mt-1 text-xs text-slate-500">${item.variant}</p>
                </td>
                <td className="px-4 py-4">
                  <span className="font-black">${item.available}</span>
                  ${item.lowStock && html`<${Badge} tone="amber" label="Low" />`}
                </td>
                <td className="px-4 py-4">${item.reserved}</td>
                <td className="px-4 py-4">${item.sold}</td>
                <td className="px-4 py-4 font-semibold">${money((item.sellingPrice || 0) - (item.unitCost || 0))}</td>
                <td className="py-4 pl-4 text-right">
                  <button className=${SECONDARY_BUTTON} type="button" onClick=${() => onRestock(item.id, 5)}>
                    +5 stock
                  </button>
                </td>
              </tr>
            `
          )}
        </tbody>
      </table>
    </div>
  `;
}

function CustomerCard({ profile }) {
  return html`
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black">${profile.name}</h3>
          <p className="mt-1 text-sm text-slate-500">${profile.phone || "No phone"}</p>
        </div>
        <${Badge} tone=${profile.orders > 1 ? "green" : "slate"} label=${profile.orders > 1 ? "Repeat" : "New"} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <${BookValue} label="Spend" value=${money(profile.totalSpend)} />
        <${BookValue} label="Outstanding" value=${money(profile.outstanding)} />
        <${BookValue} label="Orders" value=${profile.orders} />
        <${BookValue} label="Agent" value=${profile.assignedAgent} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        Prefers ${profile.preferredProduct}. Last order ${relativeAge(profile.lastOrderAt)}.
      </p>
    </article>
  `;
}

function AgentCard({ agent, maxSales }) {
  const width = Math.round((agent.salesValue / maxSales) * 100);
  return html`
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-black">${agent.agent}</h3>
          <p className="mt-1 text-sm text-slate-500">${agent.conversionRate}% conversion</p>
        </div>
        <${Badge} tone=${agent.unresolved ? "amber" : "green"} label=${`${agent.unresolved} open`} />
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-emerald-700" style=${{ width: `${width}%` }}></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <${BookValue} label="Sales" value=${money(agent.salesValue)} />
        <${BookValue} label="Orders" value=${agent.orders} />
        <${BookValue} label="Outstanding" value=${money(agent.outstanding)} />
        <${BookValue} label="Discounts" value=${money(agent.discounts)} />
      </div>
    </article>
  `;
}

function StockSignal({ item }) {
  return html`
    <article className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-700">${item.sku}</p>
      <p className="mt-2 font-black text-slate-950">${item.productName}</p>
      <p className="mt-1 text-sm text-slate-600">${item.variant} · ${item.available} available</p>
    </article>
  `;
}

function AuditTrail({ logs }) {
  if (!logs.length) return html`<${EmptyState} message="No audit entries." />`;

  return html`
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
            <th className="border-b border-slate-200 py-3 pr-4">Time</th>
            <th className="border-b border-slate-200 px-4 py-3">Actor</th>
            <th className="border-b border-slate-200 py-3 pl-4">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          ${logs.slice(0, 24).map(
            (log) => html`
              <tr key=${log.id}>
                <td className="py-4 pr-4 text-slate-600">${formatDateTime(log.at)}</td>
                <td className="px-4 py-4 font-semibold">${log.actor}</td>
                <td className="py-4 pl-4">${log.action}</td>
              </tr>
            `
          )}
        </tbody>
      </table>
    </div>
  `;
}

function SearchBox({ value, onChange, placeholder }) {
  return html`
    <label className="relative block w-full md:max-w-md">
      <${Search} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        className=${`${FIELD} pl-9`}
        value=${value}
        onChange=${(event) => onChange(event.target.value)}
        placeholder=${placeholder}
      />
    </label>
  `;
}

function TextField({ label, value, onChange, placeholder, list, required = false }) {
  return html`
    <label className=${LABEL}>
      ${label}
      <input
        className=${FIELD}
        value=${value}
        list=${list}
        required=${required}
        onChange=${(event) => onChange(event.target.value)}
        placeholder=${placeholder}
      />
    </label>
  `;
}

function NumberField({ label, value, onChange, min = "0" }) {
  return html`
    <label className=${LABEL}>
      ${label}
      <input
        className=${FIELD}
        type="number"
        inputMode="decimal"
        min=${min}
        value=${value}
        onChange=${(event) => onChange(event.target.value)}
      />
    </label>
  `;
}

function SelectField({ label, value, onChange, options, formatter = (item) => item }) {
  return html`
    <label className=${LABEL}>
      ${label}
      <select className=${FIELD} value=${value} onChange=${(event) => onChange(event.target.value)}>
        ${options.map(
          (option) => html`<option key=${option} value=${option}>${formatter(option)}</option>`
        )}
      </select>
    </label>
  `;
}

function Badge({ label, tone = "slate" }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    blue: "bg-blue-50 text-blue-800 ring-blue-200",
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
  };

  return html`
    <span className=${`inline-flex min-h-6 items-center rounded-full px-2.5 text-xs font-black ring-1 ${tones[tone]}`}>
      ${label}
    </span>
  `;
}

function BookValue({ label, value }) {
  return html`
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">${label}</p>
      <p className="mt-1 break-words text-sm font-black text-slate-950">${value}</p>
    </div>
  `;
}

function EmptyState({ message }) {
  return html`
    <div className="grid min-h-28 w-full place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-medium text-slate-500">
      ${message}
    </div>
  `;
}

function LoadingScreen() {
  return html`
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] p-6 text-center">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-[0_24px_80px_rgba(17,24,39,.08)]">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <${Gauge} className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-black text-slate-950">Loading Dukaspot</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Connecting to the ledger API and preparing the merchant control desk.
        </p>
      </div>
    </main>
  `;
}

function ErrorScreen({ error, onRetry }) {
  return html`
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] p-6 text-center">
      <div className="w-full max-w-md rounded-lg border border-rose-200 bg-white p-6 shadow-[0_24px_80px_rgba(17,24,39,.08)]">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-100">
          <${AlertTriangle} className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-lg font-black text-slate-950">Ledger API unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">${error}</p>
        <button className=${PRIMARY_BUTTON} type="button" onClick=${onRetry}>
          <${RefreshCw} className="h-4 w-4" /> Retry
        </button>
      </div>
    </main>
  `;
}

function Toast({ message }) {
  return html`
    <div
      className=${[
        "fixed bottom-5 right-5 z-50 max-w-[calc(100vw-2.5rem)] rounded-lg border border-emerald-300/20 bg-[#07110f] px-4 py-3 text-sm font-semibold text-white shadow-2xl transition",
        message ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      ].join(" ")}
      role="status"
      aria-live="polite"
    >
      ${message}
    </div>
  `;
}

function useLedgerApi(notify) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const nextPayload = await apiRequest("/ledger");
      setPayload(nextPayload);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const mutate = async (path, options = {}) => {
    setError("");
    try {
      const nextPayload = await apiRequest(path, options);
      if (nextPayload?.state) setPayload(nextPayload);
      if (nextPayload?.message) {
        notify(nextPayload.message);
      }
      return nextPayload;
    } catch (requestError) {
      setError(requestError.message);
      notify(requestError.message);
      return null;
    }
  };

  return {
    state: payload?.state,
    payload,
    loading,
    error,
    refresh,
    mutate,
  };
}

async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    options.timeoutMs || REQUEST_TIMEOUT_MS
  );

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method || "GET",
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Dukaspot API timed out. Try again.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload?.error
        ? payload.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function useHashView() {
  const getCurrent = () => {
    const id = window.location.hash.replace("#", "");
    return NAV_ITEMS.some((item) => item.id === id) ? id : "dashboard";
  };
  const [activeView, setActiveViewState] = useState(getCurrent);

  useEffect(() => {
    const listener = () => setActiveViewState(getCurrent());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);

  const setActiveView = (id) => {
    window.location.hash = id;
    setActiveViewState(id);
  };

  return [activeView, setActiveView];
}

function setHash(id) {
  window.location.hash = id;
}

function sampleCsv() {
  const now = new Date().toISOString();
  return [
    "Date,Receipt,Payer,Phone,Paid In,Details",
    `${now},QH80NEW001,Nadia Hassan,0100991881,4850,Received from Nadia Hassan 0100991881`,
    `${now},QH80NEW002,Felix Mwangi,0711333902,2650,Received from Felix Mwangi 0711333902`,
    `${now},QH80NEW003,Owner Cash,0700000111,3000,Owner cash top up`,
  ].join("\n");
}

async function downloadFromApi(path, filename, notify = () => {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify("Download ready");
  } catch (error) {
    notify(error.name === "AbortError" ? "Download timed out. Try again." : error.message);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (date.toString() === "Invalid Date") return "Invalid date";
  return date.toLocaleString("en-KE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function relativeAge(value) {
  const diff = Date.now() - new Date(value).getTime();
  const hours = Math.max(0, Math.round(diff / 36e5));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function titleCase(value = "") {
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.slice(1));
}

createRoot(document.querySelector("#root")).render(html`<${App} />`);
