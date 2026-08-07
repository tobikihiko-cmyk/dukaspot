"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileSpreadsheet,
  Gauge,
  LockKeyhole,
  LogIn,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Store,
  Upload,
  Users,
  WalletCards,
} from "lucide-react";
import { ORDER_STAGES, money } from "@dukaspot/core";
import { ApiHealthPill } from "./api-health-pill";

const API_BASE = "/api";
const REQUEST_TIMEOUT_MS = 12_000;
const CSRF_HEADER_NAME = "x-csrf-token";
let csrfTokenCache = "";
let csrfTokenRequest: Promise<string> | null = null;

const NAV_ITEMS = [
  { id: "command", label: "Command", icon: Gauge, permission: "merchant:read" },
  { id: "orders", label: "Orders", icon: ClipboardCheck, permission: "order:read" },
  { id: "reconcile", label: "Reconcile", icon: WalletCards, permission: "payment:read" },
  { id: "inventory", label: "Stock", icon: Package, permission: "inventory:read" },
  { id: "accounting", label: "Accounting", icon: FileSpreadsheet, permission: "report:read" },
  { id: "reports", label: "Reports", icon: ShieldCheck, permission: "report:read" },
] as const;

const INITIAL_ORDER = {
  customerName: "",
  phone: "",
  productName: "",
  variant: "",
  quantity: "1",
  unitPrice: "0",
  unitCost: "0",
  deliveryFee: "0",
  discount: "0",
  location: "",
  source: "WhatsApp",
  agent: "Unassigned",
  stage: "confirmed",
};

const SAMPLE_CSV = [
  "Date,Receipt,Payer,Phone,Paid In,Details",
  "2026-08-06T10:30:00+03:00,QH80WEB001,Web Buyer,0712444000,1050,Received from Web Buyer 0712444000",
].join("\n");

type AuthSession = {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
  memberships: Membership[];
  currentTenant: Membership;
};

type Membership = {
  id: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: string;
  role: string;
  permissions: string[];
};

type LedgerOrder = {
  id: string;
  createdAt?: string;
  customerName: string;
  phone: string;
  productName: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  deliveryFee?: number;
  discount?: number;
  location?: string;
  source?: string;
  agent?: string;
  stage: string;
  paymentStatus?: string;
  balance?: number;
  total?: number;
  paidAmount?: number;
  grossProfit?: number;
  computedPaymentStatus?: string;
};

type LedgerPayment = {
  id: string;
  receipt?: string;
  receivedAt?: string;
  payerName?: string;
  phone?: string;
  amount: number;
  details?: string;
  classification: string;
  status: string;
  orderId?: string;
};

type InventoryRow = {
  id: string;
  sku?: string;
  productName?: string;
  variant?: string;
  onHand?: number;
  available?: number;
  committed?: number;
  reorderPoint?: number;
  lowStock?: boolean;
  unitCost?: number;
  sellingPrice?: number;
};

type LedgerState = {
  merchant: Record<string, unknown>;
  agents: string[];
  inventory: InventoryRow[];
  orders: LedgerOrder[];
  payments: LedgerPayment[];
  auditLog: Array<Record<string, unknown>>;
  createdAt?: string;
  updatedAt?: string;
};

type LedgerPayload = {
  state: LedgerState;
  summary: Record<string, unknown>;
  reconciliation: {
    unmatchedPayments?: LedgerPayment[];
    matchedPayments?: LedgerPayment[];
    duplicatePayments?: LedgerPayment[];
    suggestions?: Record<string, Array<Record<string, unknown>>>;
  };
  inventoryRows: InventoryRow[];
  followUps: LedgerOrder[];
  customers: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  ownerReport: string;
  message?: string;
  imported?: number;
};

type TrialBalance = {
  merchantId: string;
  currency: string;
  generatedAt: string;
  accounts: TrialBalanceAccount[];
  totalDebits: number;
  totalCredits: number;
  balanced: boolean;
};

type TrialBalanceAccount = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  balance: number;
};

type ApiOptions = {
  method?: string;
  body?: unknown;
  merchantId?: string;
  idempotent?: boolean;
};

class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "INTERNAL_ERROR"
  ) {
    super(message);
  }
}

export function MerchantWorkspace() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [selectedMerchantId, setSelectedMerchantId] = useState("");
  const [ledger, setLedger] = useState<LedgerPayload | null>(null);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [activeView, setActiveView] = useState<(typeof NAV_ITEMS)[number]["id"]>("command");
  const [sessionLoading, setSessionLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTenant = useMemo(() => {
    if (!session) return null;
    return (
      session.memberships.find((membership) => membership.merchantId === selectedMerchantId) ||
      session.currentTenant
    );
  }, [selectedMerchantId, session]);

  const can = useCallback(
    (permission: string) => Boolean(selectedTenant?.permissions.includes(permission)),
    [selectedTenant]
  );

  const refreshData = useCallback(
    async (merchantId: string) => {
      if (!merchantId || !session) return;
      const tenant = session.memberships.find((membership) => membership.merchantId === merchantId);
      setDataLoading(true);
      setError("");
      try {
        const ledgerPayload = await apiJson<LedgerPayload>("/ledger", { merchantId });
        setLedger(ledgerPayload);

        if (tenant?.permissions.includes("report:read")) {
          const nextTrialBalance = await apiJson<TrialBalance>("/accounting/trial-balance", {
            merchantId,
          });
          setTrialBalance(nextTrialBalance);
        } else {
          setTrialBalance(null);
        }
      } catch (requestError) {
        handleRequestError(requestError, setError, setSession);
      } finally {
        setDataLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    let active = true;
    async function resumeSession() {
      setSessionLoading(true);
      try {
        const nextSession = await apiJson<AuthSession>("/auth/me");
        if (!active) return;
        setSession(nextSession);
        setSelectedMerchantId(nextSession.currentTenant.merchantId);
      } catch (requestError) {
        if (!active) return;
        if (requestError instanceof ApiClientError && requestError.status === 401) {
          setSession(null);
          setSelectedMerchantId("");
          return;
        }
        setError(errorMessage(requestError));
      } finally {
        if (active) setSessionLoading(false);
      }
    }

    void resumeSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session && selectedMerchantId) {
      void refreshData(selectedMerchantId);
    }
  }, [refreshData, selectedMerchantId, session]);

  async function authenticate(path: "/auth/login" | "/auth/register", body: Record<string, string>) {
    setError("");
    setNotice("");
    setMutating(true);
    try {
      const nextSession = await apiJson<AuthSession>(path, {
        method: "POST",
        body,
      });
      setSession(nextSession);
      setSelectedMerchantId(nextSession.currentTenant.merchantId);
      setNotice(path === "/auth/register" ? "Account ready" : "Signed in");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setMutating(false);
    }
  }

  async function logout() {
    setMutating(true);
    try {
      await apiJson<{ ok: true }>("/auth/logout", { method: "POST" });
    } catch {
      // The local session is cleared even if the server has already expired it.
    } finally {
      resetCsrfToken();
      setSession(null);
      setLedger(null);
      setTrialBalance(null);
      setSelectedMerchantId("");
      setMutating(false);
      setNotice("");
    }
  }

  async function runMutation(path: string, body?: unknown, method = "POST") {
    if (!selectedMerchantId) return;
    setMutating(true);
    setError("");
    setNotice("");
    try {
      const nextPayload = await apiJson<LedgerPayload>(path, {
        method,
        body,
        merchantId: selectedMerchantId,
        idempotent: true,
      });
      setLedger(nextPayload);
      setNotice(nextPayload.message || "Saved");
      if (can("report:read")) {
        setTrialBalance(
          await apiJson<TrialBalance>("/accounting/trial-balance", {
            merchantId: selectedMerchantId,
          })
        );
      }
    } catch (requestError) {
      handleRequestError(requestError, setError, setSession);
    } finally {
      setMutating(false);
    }
  }

  async function downloadCsv(path: string, filename: string) {
    if (!selectedMerchantId) return;
    setError("");
    setNotice("");
    try {
      const blob = await apiBlob(path, selectedMerchantId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("Download ready");
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }

  if (sessionLoading) {
    return <LoadingScreen />;
  }

  if (!session || !selectedTenant) {
    return (
      <AuthScreen
        busy={mutating}
        error={error}
        notice={notice}
        onLogin={(body) => void authenticate("/auth/login", body)}
        onRegister={(body) => void authenticate("/auth/register", body)}
      />
    );
  }

  const visibleNav = NAV_ITEMS.filter((item) => can(item.permission));
  const safeActiveView = visibleNav.some((item) => item.id === activeView)
    ? activeView
    : visibleNav[0]?.id || "command";

  return (
    <main className="min-h-screen bg-[#f5f7f6] text-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[276px_minmax(0,1fr)]">
        <aside className="bg-[#07110f] px-4 py-5 text-white lg:min-h-screen">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md border border-emerald-300/25 bg-emerald-400/10 text-sm font-black text-emerald-100">
              DS
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold">Dukaspot</p>
              <p className="truncate text-sm text-slate-400">{selectedTenant.merchantName}</p>
            </div>
          </div>

          <nav className="mt-8 grid gap-1" aria-label="Primary">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = safeActiveView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  className={[
                    "inline-flex h-10 items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-emerald-300/20",
                    active
                      ? "bg-white text-slate-950"
                      : "text-slate-300 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-8 border-t border-white/10 pt-4 text-sm text-slate-300">
            <p className="font-semibold text-white">{session.user.name}</p>
            <p className="mt-1 truncate">{session.user.email}</p>
            <p className="mt-3 inline-flex rounded-md border border-white/10 px-2 py-1 text-xs font-bold text-emerald-100">
              {selectedTenant.role.replace(/_/g, " ")}
            </p>
          </div>
        </aside>

        <section className="px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-6">
            <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-700">Merchant workspace</p>
                <h1 className="mt-2 truncate text-2xl font-black tracking-normal text-slate-950 sm:text-3xl">
                  {selectedTenant.merchantName}
                </h1>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <TenantSelect
                  memberships={session.memberships}
                  selectedMerchantId={selectedMerchantId}
                  onChange={setSelectedMerchantId}
                />
                <ApiHealthPill />
                <button
                  type="button"
                  onClick={() => void refreshData(selectedMerchantId)}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-emerald-700/15"
                  disabled={dataLoading}
                >
                  <RefreshCw className={["h-4 w-4", dataLoading ? "animate-spin" : ""].join(" ")} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => void logout()}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-emerald-700/15"
                  disabled={mutating}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </header>

            {notice ? <StatusBanner tone="success" message={notice} /> : null}
            {error ? <StatusBanner tone="error" message={error} /> : null}

            {!ledger && dataLoading ? <LoadingPanel /> : null}
            {!ledger && !dataLoading ? (
              <EmptyDataPanel onRefresh={() => void refreshData(selectedMerchantId)} />
            ) : null}

            {ledger ? (
              <>
                <SummaryGrid ledger={ledger} trialBalance={trialBalance} />
                {safeActiveView === "command" ? (
                  <CommandView ledger={ledger} trialBalance={trialBalance} can={can} />
                ) : null}
                {safeActiveView === "orders" ? (
                  <OrdersView
                    ledger={ledger}
                    canWrite={can("order:write")}
                    busy={mutating}
                    onCreate={(order) => void runMutation("/orders", order)}
                    onUpdateStage={(orderId, stage) =>
                      void runMutation(`/orders/${encodeURIComponent(orderId)}`, { stage }, "PATCH")
                    }
                  />
                ) : null}
                {safeActiveView === "reconcile" ? (
                  <ReconcileView
                    ledger={ledger}
                    canAllocate={can("payment:allocate")}
                    busy={mutating}
                    onImport={(csv) => void runMutation("/payments/import", { csv })}
                    onMatch={(paymentId, orderId) =>
                      void runMutation(`/payments/${encodeURIComponent(paymentId)}/match`, { orderId })
                    }
                    onClassify={(paymentId, classification) =>
                      void runMutation(`/payments/${encodeURIComponent(paymentId)}/classify`, {
                        classification,
                      })
                    }
                    onUnmatch={(paymentId) =>
                      void runMutation(`/payments/${encodeURIComponent(paymentId)}/unmatch`)
                    }
                  />
                ) : null}
                {safeActiveView === "inventory" ? (
                  <InventoryView
                    ledger={ledger}
                    canWrite={can("inventory:write")}
                    busy={mutating}
                    onAdd={(item) => void runMutation("/inventory", item)}
                    onRestock={(itemId, quantity) =>
                      void runMutation(`/inventory/${encodeURIComponent(itemId)}/restock`, { quantity })
                    }
                  />
                ) : null}
                {safeActiveView === "accounting" ? (
                  <AccountingView trialBalance={trialBalance} canRead={can("report:read")} />
                ) : null}
                {safeActiveView === "reports" ? (
                  <ReportsView
                    ledger={ledger}
                    canRead={can("report:read")}
                    onDownloadOrders={() => void downloadCsv("/exports/orders.csv", "dukaspot-orders.csv")}
                    onDownloadPayments={() =>
                      void downloadCsv("/exports/payments.csv", "dukaspot-payments.csv")
                    }
                  />
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthScreen({
  busy,
  error,
  notice,
  onLogin,
  onRegister,
}: {
  busy: boolean;
  error: string;
  notice: string;
  onLogin: (body: Record<string, string>) => void;
  onRegister: (body: Record<string, string>) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onLogin({
      email: formValue(form, "email"),
      password: formValue(form, "password"),
    });
  }

  function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onRegister({
      email: formValue(form, "email"),
      password: formValue(form, "password"),
      name: formValue(form, "name"),
      merchantName: formValue(form, "merchantName"),
      legalName: formValue(form, "legalName"),
    });
  }

  return (
    <main className="min-h-screen bg-[#f5f7f6] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-6xl content-center gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,0.7fr)]">
        <section className="grid content-center gap-6">
          <div>
            <div className="inline-grid h-12 w-12 place-items-center rounded-md bg-[#07110f] text-sm font-black text-emerald-100">
              DS
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-black tracking-normal text-slate-950 sm:text-4xl">
              Dukaspot merchant workspace
            </h1>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <AuthSignal icon={LockKeyhole} label="Session" value="Cookie" />
            <AuthSignal icon={Building2} label="Tenant" value="Merchant" />
            <AuthSignal icon={ShieldCheck} label="Access" value="Role" />
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={[
                "h-9 flex-1 rounded-md text-sm font-bold transition",
                mode === "login" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600",
              ].join(" ")}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={[
                "h-9 flex-1 rounded-md text-sm font-bold transition",
                mode === "register" ? "bg-white text-slate-950 shadow-sm" : "text-slate-600",
              ].join(" ")}
            >
              Register
            </button>
          </div>

          <div className="mt-4 flex justify-end">
            <ApiHealthPill />
          </div>

          {notice ? <StatusBanner tone="success" message={notice} /> : null}
          {error ? <StatusBanner tone="error" message={error} /> : null}

          {mode === "login" ? (
            <form className="mt-4 grid gap-3" onSubmit={submitLogin}>
              <TextField name="email" label="Email" type="email" autoComplete="email" required />
              <TextField
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogIn className="h-4 w-4" />
                Sign in
              </button>
            </form>
          ) : (
            <form className="mt-4 grid gap-3" onSubmit={submitRegister}>
              <TextField name="name" label="Name" autoComplete="name" required />
              <TextField name="merchantName" label="Merchant" required />
              <TextField name="legalName" label="Legal name" />
              <TextField name="email" label="Email" type="email" autoComplete="email" required />
              <TextField
                name="password"
                label="Password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="mt-1 inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Store className="h-4 w-4" />
                Register
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function AuthSignal({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof LockKeyhole;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <Icon className="h-5 w-5 text-emerald-700" />
      <p className="mt-3 text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function TenantSelect({
  memberships,
  selectedMerchantId,
  onChange,
}: {
  memberships: Membership[];
  selectedMerchantId: string;
  onChange: (merchantId: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-600">
      <span className="sr-only">Merchant</span>
      <select
        value={selectedMerchantId}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-48 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/15"
      >
        {memberships.map((membership) => (
          <option key={membership.id} value={membership.merchantId}>
            {membership.merchantName}
          </option>
        ))}
      </select>
    </label>
  );
}

function SummaryGrid({
  ledger,
  trialBalance,
}: {
  ledger: LedgerPayload;
  trialBalance: TrialBalance | null;
}) {
  const summary = ledger.summary;
  const tiles = [
    {
      label: "Today enquiries",
      value: String(asNumber(summary.enquiries)),
      icon: Gauge,
      tone: "text-blue-700",
    },
    {
      label: "Collected",
      value: money(summary.collected),
      icon: CreditCard,
      tone: "text-emerald-700",
    },
    {
      label: "Unmatched",
      value: money(summary.unmatched),
      icon: AlertCircle,
      tone: "text-amber-700",
    },
    {
      label: "Trial balance",
      value: trialBalance?.balanced ? "Balanced" : trialBalance ? "Review" : "Locked",
      icon: FileSpreadsheet,
      tone: trialBalance?.balanced ? "text-emerald-700" : "text-rose-700",
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Merchant metrics">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <article key={tile.label} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-500">{tile.label}</p>
              <Icon className={["h-5 w-5", tile.tone].join(" ")} />
            </div>
            <p className="mt-3 truncate text-2xl font-black text-slate-950">{tile.value}</p>
          </article>
        );
      })}
    </section>
  );
}

function CommandView({
  ledger,
  trialBalance,
  can,
}: {
  ledger: LedgerPayload;
  trialBalance: TrialBalance | null;
  can: (permission: string) => boolean;
}) {
  const queues = [
    ["Suggested matches", suggestionCount(ledger), "text-emerald-700"],
    ["Partial payments", ledger.state.orders.filter((order) => order.paymentStatus === "partial").length, "text-amber-700"],
    ["Needs investigation", ledger.reconciliation.unmatchedPayments?.length || 0, "text-rose-700"],
    ["Low stock", ledger.inventoryRows.filter((item) => item.lowStock).length, "text-blue-700"],
  ] as const;

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Work queues</h2>
          <WalletCards className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {queues.map(([label, count, tone]) => (
            <div key={label} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-600">{label}</p>
              <p className={["mt-2 text-xl font-black", tone].join(" ")}>{count}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Access</h2>
          <Users className="h-5 w-5 text-blue-700" />
        </div>
        <div className="mt-4 grid gap-2 text-sm">
          <PermissionRow label="Orders" enabled={can("order:write")} />
          <PermissionRow label="Payments" enabled={can("payment:allocate")} />
          <PermissionRow label="Inventory" enabled={can("inventory:write")} />
          <PermissionRow label="Reports" enabled={can("report:read")} />
        </div>
        {trialBalance ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-500">Accounting total</p>
            <p className="mt-1 text-xl font-black text-slate-950">{money(trialBalance.totalDebits)}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function OrdersView({
  ledger,
  canWrite,
  busy,
  onCreate,
  onUpdateStage,
}: {
  ledger: LedgerPayload;
  canWrite: boolean;
  busy: boolean;
  onCreate: (order: Record<string, unknown>) => void;
  onUpdateStage: (orderId: string, stage: string) => void;
}) {
  const [draft, setDraft] = useState(INITIAL_ORDER);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({
      ...draft,
      quantity: Number(draft.quantity) || 1,
      unitPrice: Number(draft.unitPrice) || 0,
      unitCost: Number(draft.unitCost) || 0,
      deliveryFee: Number(draft.deliveryFee) || 0,
      discount: Number(draft.discount) || 0,
    });
    setDraft(INITIAL_ORDER);
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Orders</h2>
          <ClipboardCheck className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-4 font-bold">Order</th>
                <th className="py-2 pr-4 font-bold">Customer</th>
                <th className="py-2 pr-4 font-bold">Item</th>
                <th className="py-2 pr-4 font-bold">Balance</th>
                <th className="py-2 pr-4 font-bold">Stage</th>
              </tr>
            </thead>
            <tbody>
              {ledger.state.orders.slice(0, 8).map((order) => (
                <tr key={order.id} className="border-b border-slate-100">
                  <td className="py-3 pr-4 font-bold text-slate-950">{order.id}</td>
                  <td className="py-3 pr-4 text-slate-700">{order.customerName}</td>
                  <td className="py-3 pr-4 text-slate-700">{order.productName}</td>
                  <td className="py-3 pr-4 font-bold text-slate-950">{money(order.balance || 0)}</td>
                  <td className="py-3 pr-4">
                    <select
                      value={order.stage}
                      disabled={!canWrite || busy}
                      onChange={(event) => onUpdateStage(order.id, event.target.value)}
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      {ORDER_STAGES.map((stage) => (
                        <option key={stage} value={stage}>
                          {titleCase(stage)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form className="rounded-md border border-slate-200 bg-white p-4 shadow-sm" onSubmit={submit}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">New order</h2>
          <Plus className="h-5 w-5 text-blue-700" />
        </div>
        <fieldset disabled={!canWrite || busy} className="mt-4 grid gap-3 disabled:opacity-60">
          <TextField label="Customer" name="customerName" value={draft.customerName} onValue={(value) => setDraft({ ...draft, customerName: value })} required />
          <TextField label="Phone" name="phone" value={draft.phone} onValue={(value) => setDraft({ ...draft, phone: value })} required />
          <TextField label="Product" name="productName" value={draft.productName} onValue={(value) => setDraft({ ...draft, productName: value })} required />
          <TextField label="Variant" name="variant" value={draft.variant} onValue={(value) => setDraft({ ...draft, variant: value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Qty" name="quantity" type="number" min="1" value={draft.quantity} onValue={(value) => setDraft({ ...draft, quantity: value })} required />
            <TextField label="Price" name="unitPrice" type="number" min="0" value={draft.unitPrice} onValue={(value) => setDraft({ ...draft, unitPrice: value })} required />
            <TextField label="Cost" name="unitCost" type="number" min="0" value={draft.unitCost} onValue={(value) => setDraft({ ...draft, unitCost: value })} required />
            <TextField label="Delivery" name="deliveryFee" type="number" min="0" value={draft.deliveryFee} onValue={(value) => setDraft({ ...draft, deliveryFee: value })} />
          </div>
          <TextField label="Agent" name="agent" value={draft.agent} onValue={(value) => setDraft({ ...draft, agent: value })} />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15 disabled:cursor-not-allowed"
          >
            <Send className="h-4 w-4" />
            Capture order
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function ReconcileView({
  ledger,
  canAllocate,
  busy,
  onImport,
  onMatch,
  onClassify,
  onUnmatch,
}: {
  ledger: LedgerPayload;
  canAllocate: boolean;
  busy: boolean;
  onImport: (csv: string) => void;
  onMatch: (paymentId: string, orderId: string) => void;
  onClassify: (paymentId: string, classification: string) => void;
  onUnmatch: (paymentId: string) => void;
}) {
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const openOrders = ledger.state.orders.filter((order) => !["cancelled", "returned"].includes(order.stage));
  const payments = ledger.state.payments.slice(0, 10);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onImport(csv);
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Payments</h2>
          <CreditCard className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="mt-4 grid gap-3">
          {payments.map((payment) => (
            <div key={payment.id} className="grid gap-3 border-b border-slate-100 pb-3 lg:grid-cols-[1fr_220px]">
              <div>
                <p className="font-bold text-slate-950">{payment.payerName || payment.receipt || payment.id}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {money(payment.amount)} · {titleCase(payment.classification)} · {titleCase(payment.status)}
                </p>
              </div>
              <div className="grid gap-2">
                <select
                  disabled={!canAllocate || busy}
                  defaultValue={payment.orderId || ""}
                  onChange={(event) => {
                    if (event.target.value) onMatch(payment.id, event.target.value);
                  }}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <option value="">Match order</option>
                  {openOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.id} · {order.customerName}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={!canAllocate || busy}
                    onClick={() => onClassify(payment.id, "owner_deposit")}
                    className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    Owner
                  </button>
                  <button
                    type="button"
                    disabled={!canAllocate || busy}
                    onClick={() => onClassify(payment.id, "business_expense")}
                    className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                  >
                    Expense
                  </button>
                  {payment.orderId ? (
                    <button
                      type="button"
                      disabled={!canAllocate || busy}
                      onClick={() => onUnmatch(payment.id)}
                      className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                      aria-label={`Unmatch ${payment.id}`}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form className="rounded-md border border-slate-200 bg-white p-4 shadow-sm" onSubmit={submit}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Import CSV</h2>
          <Upload className="h-5 w-5 text-blue-700" />
        </div>
        <fieldset disabled={!canAllocate || busy} className="mt-4 grid gap-3 disabled:opacity-60">
          <textarea
            value={csv}
            onChange={(event) => setCsv(event.target.value)}
            className="min-h-52 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/15"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function InventoryView({
  ledger,
  canWrite,
  busy,
  onAdd,
  onRestock,
}: {
  ledger: LedgerPayload;
  canWrite: boolean;
  busy: boolean;
  onAdd: (item: Record<string, unknown>) => void;
  onRestock: (itemId: string, quantity: number) => void;
}) {
  const [quantityByItem, setQuantityByItem] = useState<Record<string, string>>({});

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onAdd({
      sku: formValue(form, "sku"),
      productName: formValue(form, "productName"),
      variant: formValue(form, "variant"),
      onHand: Number(formValue(form, "onHand")) || 0,
      reorderPoint: Number(formValue(form, "reorderPoint")) || 0,
      unitCost: Number(formValue(form, "unitCost")) || 0,
      sellingPrice: Number(formValue(form, "sellingPrice")) || 0,
    });
    event.currentTarget.reset();
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Inventory</h2>
          <Package className="h-5 w-5 text-emerald-700" />
        </div>
        <div className="mt-4 grid gap-3">
          {ledger.inventoryRows.map((item) => (
            <div key={item.id} className="grid gap-3 border-b border-slate-100 pb-3 lg:grid-cols-[1fr_180px]">
              <div>
                <p className="font-bold text-slate-950">{item.productName || item.sku || item.id}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {item.variant || "Default"} · On hand {asNumber(item.onHand)} · Available {asNumber(item.available ?? item.onHand)}
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  value={quantityByItem[item.id] || ""}
                  onChange={(event) =>
                    setQuantityByItem({ ...quantityByItem, [item.id]: event.target.value })
                  }
                  disabled={!canWrite || busy}
                  type="number"
                  min="1"
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 px-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                  aria-label={`Restock ${item.productName || item.id}`}
                />
                <button
                  type="button"
                  disabled={!canWrite || busy}
                  onClick={() => onRestock(item.id, Number(quantityByItem[item.id]) || 0)}
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  Restock
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form className="rounded-md border border-slate-200 bg-white p-4 shadow-sm" onSubmit={submitAdd}>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">New item</h2>
          <Plus className="h-5 w-5 text-blue-700" />
        </div>
        <fieldset disabled={!canWrite || busy} className="mt-4 grid gap-3 disabled:opacity-60">
          <TextField name="sku" label="SKU" required />
          <TextField name="productName" label="Product" required />
          <TextField name="variant" label="Variant" />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField name="onHand" label="On hand" type="number" min="0" required />
            <TextField name="reorderPoint" label="Reorder" type="number" min="0" />
            <TextField name="unitCost" label="Cost" type="number" min="0" />
            <TextField name="sellingPrice" label="Price" type="number" min="0" />
          </div>
          <button
            type="submit"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-700/15"
          >
            <Plus className="h-4 w-4" />
            Add item
          </button>
        </fieldset>
      </form>
    </section>
  );
}

function AccountingView({
  trialBalance,
  canRead,
}: {
  trialBalance: TrialBalance | null;
  canRead: boolean;
}) {
  if (!canRead) {
    return <LockedPanel label="Accounting" />;
  }

  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-black text-slate-950">Trial balance</h2>
        {trialBalance?.balanced ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-700" />
        ) : (
          <AlertCircle className="h-5 w-5 text-rose-700" />
        )}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr className="border-b border-slate-200">
              <th className="py-2 pr-4 font-bold">Code</th>
              <th className="py-2 pr-4 font-bold">Account</th>
              <th className="py-2 pr-4 text-right font-bold">Debit</th>
              <th className="py-2 pr-4 text-right font-bold">Credit</th>
              <th className="py-2 text-right font-bold">Balance</th>
            </tr>
          </thead>
          <tbody>
            {(trialBalance?.accounts || []).map((account) => (
              <tr key={account.accountCode} className="border-b border-slate-100">
                <td className="py-3 pr-4 font-mono text-xs font-bold text-slate-600">{account.accountCode}</td>
                <td className="py-3 pr-4 font-bold text-slate-950">{account.accountName}</td>
                <td className="py-3 pr-4 text-right text-slate-700">{money(account.debit)}</td>
                <td className="py-3 pr-4 text-right text-slate-700">{money(account.credit)}</td>
                <td className="py-3 text-right font-bold text-slate-950">{money(account.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="py-3 pr-4 font-bold text-slate-950" colSpan={2}>
                Totals
              </td>
              <td className="py-3 pr-4 text-right font-black text-slate-950">
                {money(trialBalance?.totalDebits || 0)}
              </td>
              <td className="py-3 pr-4 text-right font-black text-slate-950">
                {money(trialBalance?.totalCredits || 0)}
              </td>
              <td className="py-3 text-right font-black text-slate-950">
                {trialBalance?.balanced ? "Balanced" : "Review"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function ReportsView({
  ledger,
  canRead,
  onDownloadOrders,
  onDownloadPayments,
}: {
  ledger: LedgerPayload;
  canRead: boolean;
  onDownloadOrders: () => void;
  onDownloadPayments: () => void;
}) {
  if (!canRead) {
    return <LockedPanel label="Reports" />;
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-black text-slate-950">Owner report</h2>
          <FileSpreadsheet className="h-5 w-5 text-emerald-700" />
        </div>
        <pre className="mt-4 whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm leading-6 text-slate-100">
          {ledger.ownerReport}
        </pre>
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-black text-slate-950">Exports</h2>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={onDownloadOrders}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Orders CSV
          </button>
          <button
            type="button"
            onClick={onDownloadPayments}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Payments CSV
          </button>
        </div>
      </div>
    </section>
  );
}

function PermissionRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2">
      <span className="text-slate-600">{label}</span>
      <span
        className={[
          "rounded-md px-2 py-1 text-xs font-black",
          enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500",
        ].join(" ")}
      >
        {enabled ? "Enabled" : "Read only"}
      </span>
    </div>
  );
}

function TextField({
  label,
  name,
  value,
  onValue,
  type = "text",
  ...props
}: {
  label: string;
  name: string;
  value?: string;
  onValue?: (value: string) => void;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  minLength?: number;
  min?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
      <span>{label}</span>
      <input
        {...props}
        name={name}
        type={type}
        value={value}
        onChange={onValue ? (event) => onValue(event.target.value) : undefined}
        className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/15"
      />
    </label>
  );
}

function StatusBanner({ tone, message }: { tone: "success" | "error"; message: string }) {
  return (
    <div
      className={[
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold",
        tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-rose-200 bg-rose-50 text-rose-800",
      ].join(" ")}
    >
      {tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      <span>{message}</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f5f7f6] px-4 text-slate-950">
      <div className="rounded-md border border-slate-200 bg-white p-5 text-center shadow-sm">
        <RefreshCw className="mx-auto h-6 w-6 animate-spin text-emerald-700" />
        <p className="mt-3 text-sm font-bold text-slate-700">Loading session</p>
      </div>
    </main>
  );
}

function LoadingPanel() {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 text-sm font-bold text-slate-700 shadow-sm">
      Loading workspace
    </section>
  );
}

function EmptyDataPanel({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-slate-700">No ledger data loaded</p>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-bold text-white"
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </button>
    </section>
  );
}

function LockedPanel({ label }: { label: string }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <LockKeyhole className="h-5 w-5 text-slate-500" />
        <p className="font-bold text-slate-800">{label} locked</p>
      </div>
    </section>
  );
}

async function apiJson<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...(options.body ? { "content-type": "application/json" } : {}),
  };
  if (options.merchantId) headers["x-dukaspot-merchant-id"] = options.merchantId;
  if (options.idempotent) headers["idempotency-key"] = createIdempotencyKey();
  const needsCsrf = requiresCsrf(method, path);
  if (needsCsrf) headers[CSRF_HEADER_NAME] = await ensureCsrfToken();

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    const init: RequestInit = {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("API request timed out", 408, "TIMEOUT");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (needsCsrf && response.status === 403) resetCsrfToken();
    if (isApiError(payload)) {
      throw new ApiClientError(payload.error.message, response.status, payload.error.code);
    }
    throw new ApiClientError(`Request failed with status ${response.status}`, response.status);
  }

  return payload as T;
}

async function ensureCsrfToken() {
  if (csrfTokenCache) return csrfTokenCache;
  if (csrfTokenRequest) return csrfTokenRequest;

  csrfTokenRequest = fetchCsrfToken();
  try {
    csrfTokenCache = await csrfTokenRequest;
    return csrfTokenCache;
  } finally {
    csrfTokenRequest = null;
  }
}

async function fetchCsrfToken() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}/auth/csrf`, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload: unknown = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    if (!response.ok) {
      if (isApiError(payload)) {
        throw new ApiClientError(payload.error.message, response.status, payload.error.code);
      }
      throw new ApiClientError(`Request failed with status ${response.status}`, response.status);
    }
    if (!isCsrfResponse(payload)) {
      throw new ApiClientError("CSRF token response was invalid", 500);
    }
    return payload.csrfToken;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError("API request timed out", 408, "TIMEOUT");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function resetCsrfToken() {
  csrfTokenCache = "";
  csrfTokenRequest = null;
}

function requiresCsrf(method: string, path: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  return path !== "/auth/login" && path !== "/auth/register";
}

async function apiBlob(path: string, merchantId: string) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "x-dukaspot-merchant-id": merchantId,
    },
  });
  if (!response.ok) {
    throw new ApiClientError(`Download failed with status ${response.status}`, response.status);
  }
  return response.blob();
}

function handleRequestError(
  requestError: unknown,
  setError: (message: string) => void,
  setSession: (session: AuthSession | null) => void
) {
  if (requestError instanceof ApiClientError && requestError.status === 401) {
    setSession(null);
  }
  setError(errorMessage(requestError));
}

function isApiError(value: unknown): value is { error: { message: string; code: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: { message?: unknown } }).error?.message === "string"
  );
}

function isCsrfResponse(value: unknown): value is { csrfToken: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "csrfToken" in value &&
    typeof (value as { csrfToken?: unknown }).csrfToken === "string"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Request failed";
}

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `web-${crypto.randomUUID()}`;
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  return Number(value) || 0;
}

function suggestionCount(ledger: LedgerPayload) {
  return Object.values(ledger.reconciliation.suggestions || {}).reduce(
    (total, entries) => total + entries.length,
    0
  );
}

function titleCase(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (text) => text.charAt(0).toUpperCase() + text.slice(1));
}
