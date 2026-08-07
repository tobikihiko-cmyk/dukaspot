export const STORAGE_KEY = "dukaspot.ke.v1";

export const ORDER_STAGES = [
  "enquiry",
  "reserved",
  "confirmed",
  "dispatched",
  "cancelled",
  "returned",
];

export const PAYMENT_CLASSES = [
  "product_sale",
  "delivery_payment",
  "refund",
  "owner_deposit",
  "personal_transfer",
  "supplier_payment",
  "business_expense",
  "unknown",
];

const KES_FORMATTER = new Intl.NumberFormat("en-KE", {
  maximumFractionDigits: 0,
});

export function money(value) {
  return `KES ${KES_FORMATTER.format(Number(value) || 0)}`;
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "")
    .replace(/kes|ksh|,/gi, "")
    .trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizePhone(input = "") {
  const digits = String(input).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 12 && digits.startsWith("254")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("254")) return `+${digits.slice(0, 12)}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (
    digits.length === 9 &&
    (digits.startsWith("7") || digits.startsWith("1"))
  ) {
    return `+254${digits}`;
  }
  return `+${digits}`;
}

export function extractPhone(text = "") {
  const match = String(text).match(/(?:\+?254|0)?[17]\d{8}/);
  return match ? normalizePhone(match[0]) : "";
}

export function compactName(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/[^a-zA-Z\s.'-]/g, "")
    .trim();
}

export function tokenizeName(value = "") {
  return compactName(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 2);
}

export function isSameDay(a, b) {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

export function hoursBetween(a, b) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 36e5;
}

export function orderSubtotal(order) {
  return (Number(order.quantity) || 0) * (Number(order.unitPrice) || 0);
}

export function orderTotal(order) {
  return Math.max(
    0,
    orderSubtotal(order) +
      (Number(order.deliveryFee) || 0) -
      (Number(order.discount) || 0)
  );
}

export function orderCost(order) {
  return (Number(order.quantity) || 0) * (Number(order.unitCost) || 0);
}

export function orderGrossProfit(order) {
  return Math.max(0, orderSubtotal(order) - (Number(order.discount) || 0)) -
    orderCost(order);
}

export function matchedPaymentsForOrder(orderId, payments = []) {
  return payments.filter(
    (payment) =>
      payment.orderId === orderId &&
      payment.status !== "duplicate" &&
      payment.classification !== "personal_transfer" &&
      payment.classification !== "owner_deposit" &&
      payment.classification !== "business_expense" &&
      payment.classification !== "supplier_payment"
  );
}

export function deriveOrder(order, payments = []) {
  const total = orderTotal(order);
  const matchedPayments = matchedPaymentsForOrder(order.id, payments);
  const paidAmount = matchedPayments.reduce(
    (sum, payment) => sum + (Number(payment.amount) || 0),
    0
  );
  const balance = Math.max(0, total - paidAmount);
  const computedPaymentStatus =
    paidAmount <= 0
      ? order.paymentStatus || "unpaid"
      : balance <= 1
        ? "paid"
        : "partial";

  return {
    ...order,
    subtotal: orderSubtotal(order),
    total,
    paidAmount,
    balance,
    matchedPaymentCount: matchedPayments.length,
    computedPaymentStatus,
    grossProfit: orderGrossProfit(order),
  };
}

export function parseCsvRows(text = "") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeHeader(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellValue(row, headerIndex, candidates) {
  for (const candidate of candidates) {
    const index = headerIndex.get(normalizeHeader(candidate));
    if (index !== undefined) return row[index] ?? "";
  }
  return "";
}

function inferPayerName(details = "") {
  const match = String(details).match(
    /(?:from|customer|payer)\s+([a-zA-Z][a-zA-Z\s.'-]{2,})/i
  );
  return match ? compactName(match[1]) : "";
}

export function parseMpesaCsv(text = "") {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];

  const headers = rows[0];
  const headerIndex = new Map(
    headers.map((header, index) => [normalizeHeader(header), index])
  );

  return rows
    .slice(1)
    .map((row) => {
      const receipt =
        cellValue(row, headerIndex, [
          "receipt",
          "receipt no",
          "transaction id",
          "transaction code",
          "mpesa code",
          "code",
        ]) || uid("mpesa");
      const details = cellValue(row, headerIndex, [
        "details",
        "description",
        "narrative",
        "transaction details",
      ]);
      const amount =
        parseAmount(
          cellValue(row, headerIndex, [
            "paid in",
            "credit",
            "received",
            "amount",
            "paidin",
          ])
        ) ||
        -parseAmount(
          cellValue(row, headerIndex, ["withdrawn", "debit", "paid out"])
        );
      const receivedAt =
        cellValue(row, headerIndex, [
          "date",
          "time",
          "completion time",
          "transaction date",
        ]) || new Date().toISOString();
      const phone =
        normalizePhone(
          cellValue(row, headerIndex, [
            "phone",
            "msisdn",
            "mobile",
            "customer phone",
            "account",
          ])
        ) || extractPhone(details);
      const payerName =
        compactName(
          cellValue(row, headerIndex, [
            "payer",
            "customer",
            "customer name",
            "name",
            "third party",
          ])
        ) || inferPayerName(details);

      return {
        id: `pay_${String(receipt).replace(/[^a-zA-Z0-9_-]/g, "")}`,
        receipt,
        details,
        payerName,
        phone,
        amount,
        receivedAt: new Date(receivedAt).toString() === "Invalid Date"
          ? new Date().toISOString()
          : new Date(receivedAt).toISOString(),
        classification: amount < 0 ? "supplier_payment" : "unknown",
        status: amount < 0 ? "classified" : "unmatched",
        orderId: "",
        importedAt: new Date().toISOString(),
      };
    })
    .filter((payment) => payment.amount !== 0);
}

function nameOverlapScore(paymentName, customerName) {
  const paymentTokens = tokenizeName(paymentName);
  const customerTokens = tokenizeName(customerName);
  if (!paymentTokens.length || !customerTokens.length) return 0;
  const matches = paymentTokens.filter((token) => customerTokens.includes(token));
  return Math.min(18, matches.length * 9);
}

export function scorePaymentAgainstOrder(payment, order, payments = []) {
  if (!payment || !order) return { score: 0, reasons: [] };
  if (["cancelled", "returned"].includes(order.stage)) {
    return { score: 0, reasons: ["closed order"] };
  }

  const orderWithoutPayment = deriveOrder(
    order,
    payments.filter((candidate) => candidate.id !== payment.id)
  );
  const remaining = Math.max(orderWithoutPayment.balance, 0);
  const amount = Number(payment.amount) || 0;
  const total = Number(orderWithoutPayment.total) || 0;
  const reasons = [];
  let score = 0;

  if (amount > 0 && Math.abs(amount - remaining) <= 1) {
    score += 48;
    reasons.push("exact balance");
  } else if (amount > 0 && Math.abs(amount - total) <= 1) {
    score += 42;
    reasons.push("exact order total");
  } else if (amount > 0 && amount < remaining) {
    score += 24;
    reasons.push("possible deposit");
  } else if (amount > 0 && amount > remaining && amount <= total + 500) {
    score += 12;
    reasons.push("near order total");
  }

  if (normalizePhone(payment.phone) && normalizePhone(order.phone)) {
    if (normalizePhone(payment.phone) === normalizePhone(order.phone)) {
      score += 32;
      reasons.push("phone match");
    }
  }

  const overlap = nameOverlapScore(payment.payerName, order.customerName);
  if (overlap) {
    score += overlap;
    reasons.push("name match");
  }

  const paymentTime = new Date(payment.receivedAt).getTime();
  const orderTime = new Date(order.createdAt).getTime();
  if (Number.isFinite(paymentTime) && Number.isFinite(orderTime)) {
    const gap = hoursBetween(payment.receivedAt, order.createdAt);
    if (paymentTime >= orderTime && gap <= 72) {
      score += 12;
      reasons.push("recent payment");
    } else if (gap <= 168) {
      score += 6;
      reasons.push("same week");
    }
  }

  if (order.agent && payment.agent && order.agent === payment.agent) {
    score += 4;
    reasons.push("same agent");
  }

  return {
    orderId: order.id,
    score: Math.min(100, score),
    confidence: score >= 80 ? "high" : score >= 58 ? "medium" : "review",
    reasons,
  };
}

export function buildReconciliation(orders = [], payments = []) {
  const openOrders = orders.filter(
    (order) => !["cancelled", "returned"].includes(order.stage)
  );

  const suggestions = payments.reduce((accumulator, payment) => {
    if (payment.amount <= 0 || payment.orderId || payment.status === "duplicate") {
      return accumulator;
    }

    const candidates = openOrders
      .map((order) => ({
        ...scorePaymentAgainstOrder(payment, order, payments),
        order,
      }))
      .filter((candidate) => candidate.score >= 40)
      .sort((a, b) => b.score - a.score);

    accumulator[payment.id] = candidates;
    return accumulator;
  }, {});

  const unmatchedPayments = payments.filter(
    (payment) =>
      payment.amount > 0 &&
      !payment.orderId &&
      payment.status !== "duplicate" &&
      ![
        "owner_deposit",
        "personal_transfer",
        "business_expense",
        "supplier_payment",
      ].includes(payment.classification)
  );

  return {
    suggestions,
    unmatchedPayments,
    matchedPayments: payments.filter((payment) => payment.orderId),
    duplicatePayments: findDuplicatePayments(payments),
  };
}

export function findDuplicatePayments(payments = []) {
  const seen = new Map();
  const duplicates = [];

  for (const payment of payments) {
    const receipt = String(payment.receipt || "").trim().toLowerCase();
    if (!receipt) continue;
    if (seen.has(receipt)) {
      duplicates.push(payment);
    } else {
      seen.set(receipt, payment.id);
    }
  }

  return duplicates;
}

export function getFollowUps(orders = [], payments = [], asOf = new Date()) {
  return orders
    .map((order) => deriveOrder(order, payments))
    .filter((order) => {
      if (["cancelled", "returned", "dispatched"].includes(order.stage)) return false;
      if (order.computedPaymentStatus === "paid") return false;
      const ageHours = hoursBetween(asOf, order.createdAt);
      return ageHours >= 3 || ["reserved", "confirmed"].includes(order.stage);
    })
    .sort((a, b) => b.balance - a.balance);
}

export function getInventoryRows(inventory = [], orders = [], payments = []) {
  const derivedOrders = orders.map((order) => deriveOrder(order, payments));
  return inventory.map((item) => {
    const related = derivedOrders.filter(
      (order) =>
        order.productName.toLowerCase() === item.productName.toLowerCase() &&
        String(order.variant || "").toLowerCase() ===
          String(item.variant || "").toLowerCase() &&
        !["cancelled", "returned"].includes(order.stage)
    );
    const sold = related
      .filter(
        (order) =>
          order.computedPaymentStatus === "paid" || order.stage === "dispatched"
      )
      .reduce((sum, order) => sum + (Number(order.quantity) || 0), 0);
    const reserved = related
      .filter(
        (order) =>
          order.computedPaymentStatus !== "paid" &&
          ["reserved", "confirmed"].includes(order.stage)
      )
      .reduce((sum, order) => sum + (Number(order.quantity) || 0), 0);
    const available = Math.max(0, (Number(item.onHand) || 0) - sold - reserved);

    return {
      ...item,
      sold,
      reserved,
      available,
      lowStock: available <= (Number(item.reorderPoint) || 0),
    };
  });
}

export function getCustomerProfiles(orders = [], payments = []) {
  const profiles = new Map();

  for (const order of orders.map((entry) => deriveOrder(entry, payments))) {
    const key = normalizePhone(order.phone) || compactName(order.customerName);
    if (!key) continue;

    const current =
      profiles.get(key) ||
      {
        id: key,
        name: order.customerName,
        phone: normalizePhone(order.phone),
        orders: 0,
        paidOrders: 0,
        totalSpend: 0,
        outstanding: 0,
        refunds: 0,
        lastOrderAt: order.createdAt,
        preferredProducts: new Map(),
        assignedAgents: new Map(),
      };

    current.orders += 1;
    if (order.computedPaymentStatus === "paid") current.paidOrders += 1;
    current.totalSpend += Math.min(order.total, order.paidAmount);
    current.outstanding += order.balance;
    current.lastOrderAt =
      new Date(order.createdAt) > new Date(current.lastOrderAt)
        ? order.createdAt
        : current.lastOrderAt;
    current.preferredProducts.set(
      order.productName,
      (current.preferredProducts.get(order.productName) || 0) + 1
    );
    current.assignedAgents.set(
      order.agent,
      (current.assignedAgents.get(order.agent) || 0) + 1
    );

    profiles.set(key, current);
  }

  return [...profiles.values()]
    .map((profile) => {
      const { preferredProducts, assignedAgents, ...publicProfile } = profile;

      return {
        ...publicProfile,
        preferredProduct:
          [...preferredProducts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "No pattern",
        assignedAgent:
          [...assignedAgents.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
          "Unassigned",
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend);
}

export function getAgentMetrics(orders = [], payments = []) {
  const agents = new Map();

  for (const order of orders.map((entry) => deriveOrder(entry, payments))) {
    const key = order.agent || "Unassigned";
    const current =
      agents.get(key) ||
      {
        agent: key,
        enquiries: 0,
        orders: 0,
        paidOrders: 0,
        salesValue: 0,
        outstanding: 0,
        discounts: 0,
        unresolved: 0,
      };

    if (order.stage === "enquiry") current.enquiries += 1;
    if (!["cancelled", "returned"].includes(order.stage)) current.orders += 1;
    if (order.computedPaymentStatus === "paid") current.paidOrders += 1;
    current.salesValue += Math.min(order.total, order.paidAmount);
    current.outstanding += order.balance;
    current.discounts += Number(order.discount) || 0;
    if (order.balance > 0 && !["cancelled", "returned"].includes(order.stage)) {
      current.unresolved += 1;
    }

    agents.set(key, current);
  }

  return [...agents.values()].map((agent) => ({
    ...agent,
    conversionRate: agent.orders
      ? Math.round((agent.paidOrders / agent.orders) * 100)
      : 0,
  }));
}

export function getSummary(state, asOf = new Date()) {
  const orders = state.orders.map((order) => deriveOrder(order, state.payments));
  const todayOrders = orders.filter((order) => isSameDay(order.createdAt, asOf));
  const todayPayments = state.payments.filter((payment) =>
    isSameDay(payment.receivedAt, asOf)
  );
  const actionablePayments = todayPayments.filter(
    (payment) =>
      payment.amount > 0 &&
      ![
        "owner_deposit",
        "personal_transfer",
        "business_expense",
        "supplier_payment",
      ].includes(payment.classification) &&
      payment.status !== "duplicate"
  );
  const paidOrders = orders.filter(
    (order) => order.computedPaymentStatus === "paid"
  );
  const confirmedOrders = todayOrders.filter((order) =>
    ["confirmed", "dispatched"].includes(order.stage)
  );
  const unpaidReservations = orders
    .filter(
      (order) =>
        order.balance > 0 &&
        ["reserved", "confirmed"].includes(order.stage) &&
        !["cancelled", "returned"].includes(order.stage)
    )
    .reduce((sum, order) => sum + order.balance, 0);
  const grossProfit = paidOrders.reduce(
    (sum, order) => sum + order.grossProfit,
    0
  );
  const reconciliation = buildReconciliation(state.orders, state.payments);
  const lowStock = getInventoryRows(
    state.inventory,
    state.orders,
    state.payments
  ).filter((item) => item.lowStock);

  return {
    enquiries: todayOrders.filter((order) => order.stage === "enquiry").length,
    confirmedOrders: confirmedOrders.length,
    paidOrders: paidOrders.length,
    collected: actionablePayments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    ),
    unmatched: reconciliation.unmatchedPayments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    ),
    unpaidReservations,
    grossProfit,
    lowStockCount: lowStock.length,
    followUps: getFollowUps(state.orders, state.payments, asOf).length,
    matchRate: state.payments.length
      ? Math.round(
          (reconciliation.matchedPayments.length / state.payments.length) * 100
        )
      : 0,
  };
}

export function dailyOwnerReport(state, asOf = new Date()) {
  const summary = getSummary(state, asOf);
  const lowStock = getInventoryRows(
    state.inventory,
    state.orders,
    state.payments
  )
    .filter((item) => item.lowStock)
    .slice(0, 3)
    .map((item) => `${item.productName} ${item.variant}`.trim());

  return [
    `Dukaspot daily report - ${asOf.toLocaleDateString("en-KE")}`,
    `${summary.enquiries} enquiries.`,
    `${summary.confirmedOrders} confirmed orders today.`,
    `${summary.paidOrders} paid orders in ledger.`,
    `${money(summary.collected)} collected today.`,
    `${money(summary.unmatched)} in unmatched payments.`,
    `${money(summary.unpaidReservations)} in unpaid reservations.`,
    `Estimated gross profit: ${money(summary.grossProfit)}.`,
    `${summary.lowStockCount} products nearly out of stock${
      lowStock.length ? `: ${lowStock.join(", ")}` : "."
    }`,
    `${summary.followUps} customers require follow-up.`,
  ].join("\n");
}

export function toCsv(rows, headers) {
  const escape = (value) => {
    const stringValue = String(value ?? "");
    if (/[",\n\r]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  return [
    headers.map((header) => escape(header.label)).join(","),
    ...rows.map((row) =>
      headers.map((header) => escape(row[header.key])).join(",")
    ),
  ].join("\n");
}

export function createSeedData(now = new Date()) {
  const at = (hoursAgo) =>
    new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();

  const inventory = [
    {
      id: "sku_dress_black_m",
      sku: "DRS-BLK-M",
      productName: "Denim midi dress",
      variant: "Black M",
      onHand: 18,
      reorderPoint: 5,
      unitCost: 1200,
      sellingPrice: 2400,
    },
    {
      id: "sku_sneakers_white_42",
      sku: "SNK-WHT-42",
      productName: "White sneakers",
      variant: "Size 42",
      onHand: 9,
      reorderPoint: 3,
      unitCost: 2100,
      sellingPrice: 3900,
    },
    {
      id: "sku_serum_30ml",
      sku: "COS-SER-30",
      productName: "Glow serum",
      variant: "30ml",
      onHand: 12,
      reorderPoint: 6,
      unitCost: 450,
      sellingPrice: 950,
    },
    {
      id: "sku_charger_typec",
      sku: "ELC-CHG-C",
      productName: "Fast charger",
      variant: "Type-C",
      onHand: 7,
      reorderPoint: 4,
      unitCost: 600,
      sellingPrice: 1250,
    },
  ];

  const orders = [
    {
      id: "ord_1001",
      createdAt: at(2),
      customerName: "Jane Njeri",
      phone: "+254712345678",
      productName: "Denim midi dress",
      variant: "Black M",
      quantity: 1,
      unitPrice: 2400,
      unitCost: 1200,
      discount: 0,
      deliveryFee: 250,
      location: "Kilimani",
      source: "WhatsApp",
      agent: "Amina",
      stage: "confirmed",
      paymentStatus: "unpaid",
      notes: "Asked for rider delivery before 6pm.",
      lastFollowUpAt: "",
    },
    {
      id: "ord_1002",
      createdAt: at(7),
      customerName: "Brian Otieno",
      phone: "+254701555901",
      productName: "White sneakers",
      variant: "Size 42",
      quantity: 1,
      unitPrice: 3900,
      unitCost: 2100,
      discount: 200,
      deliveryFee: 300,
      location: "Westlands",
      source: "Instagram",
      agent: "Kevin",
      stage: "dispatched",
      paymentStatus: "paid",
      notes: "Repeat buyer.",
      lastFollowUpAt: "",
    },
    {
      id: "ord_1003",
      createdAt: at(26),
      customerName: "Miriam Wanjiku",
      phone: "+254722110044",
      productName: "Glow serum",
      variant: "30ml",
      quantity: 3,
      unitPrice: 950,
      unitCost: 450,
      discount: 150,
      deliveryFee: 200,
      location: "Ruiru",
      source: "TikTok",
      agent: "Amina",
      stage: "reserved",
      paymentStatus: "partial",
      notes: "Deposit paid by sister.",
      lastFollowUpAt: "",
    },
    {
      id: "ord_1004",
      createdAt: at(4),
      customerName: "Felix Mwangi",
      phone: "+254711333902",
      productName: "Fast charger",
      variant: "Type-C",
      quantity: 2,
      unitPrice: 1250,
      unitCost: 600,
      discount: 0,
      deliveryFee: 150,
      location: "CBD",
      source: "WhatsApp",
      agent: "Grace",
      stage: "enquiry",
      paymentStatus: "unpaid",
      notes: "Asked for bulk price and PayBill.",
      lastFollowUpAt: "",
    },
    {
      id: "ord_1005",
      createdAt: at(22),
      customerName: "Nadia Hassan",
      phone: "+254100991881",
      productName: "Denim midi dress",
      variant: "Black M",
      quantity: 2,
      unitPrice: 2400,
      unitCost: 1200,
      discount: 300,
      deliveryFee: 350,
      location: "Mombasa Road",
      source: "WhatsApp",
      agent: "Grace",
      stage: "confirmed",
      paymentStatus: "unpaid",
      notes: "Needs receipt for office reimbursement.",
      lastFollowUpAt: "",
    },
  ];

  const payments = [
    {
      id: "pay_QH80ABC123",
      receipt: "QH80ABC123",
      receivedAt: at(1),
      payerName: "Jane Njeri",
      phone: "+254712345678",
      amount: 2650,
      details: "Received from Jane Njeri 254712345678",
      classification: "unknown",
      status: "unmatched",
      orderId: "",
      importedAt: at(1),
    },
    {
      id: "pay_QH80ABC124",
      receipt: "QH80ABC124",
      receivedAt: at(6),
      payerName: "Brian Otieno",
      phone: "+254701555901",
      amount: 4000,
      details: "Received from Brian Otieno 254701555901",
      classification: "product_sale",
      status: "matched",
      orderId: "ord_1002",
      importedAt: at(6),
    },
    {
      id: "pay_QH80ABC125",
      receipt: "QH80ABC125",
      receivedAt: at(20),
      payerName: "Lilian Wanjiku",
      phone: "+254722110044",
      amount: 1500,
      details: "Received from Lilian Wanjiku 254722110044",
      classification: "product_sale",
      status: "matched",
      orderId: "ord_1003",
      importedAt: at(20),
    },
    {
      id: "pay_QH80ABC126",
      receipt: "QH80ABC126",
      receivedAt: at(3),
      payerName: "Samuel Kariuki",
      phone: "+254799765123",
      amount: 7200,
      details: "Received from Samuel Kariuki 254799765123",
      classification: "unknown",
      status: "unmatched",
      orderId: "",
      importedAt: at(3),
    },
    {
      id: "pay_QH80ABC127",
      receipt: "QH80ABC127",
      receivedAt: at(8),
      payerName: "Owner Transfer",
      phone: "+254700000111",
      amount: 5000,
      details: "Owner cash top up",
      classification: "owner_deposit",
      status: "classified",
      orderId: "",
      importedAt: at(8),
    },
  ];

  return {
    merchant: {
      name: "Pilot Merchant",
      till: "Buy Goods 542842",
      segment: "Social seller",
      currency: "KES",
    },
    agents: ["Amina", "Kevin", "Grace"],
    inventory,
    orders,
    payments,
    auditLog: [
      {
        id: "audit_seed",
        at: at(1),
        actor: "System",
        action: "Demo ledger loaded",
      },
    ],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
