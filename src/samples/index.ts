// Built-in datasets. Each one is a plain Datalog script, run one form at a time
// so every `transact` / `retract` becomes its own transaction. They are based
// on the scenarios in the Minigraf wiki cookbook and the minigraf-examples repo.

export interface Sample {
  id: string;
  title: string;
  summary: string;
  /** A short "try this" hint shown after loading. */
  hint: string;
  /** Example queries for the console. */
  queries: string[];
  script: string;
}

const careers: Sample = {
  id: "careers",
  title: "Careers & corrections",
  summary: "Job history with back-dated facts, a wrong salary that gets corrected, and a job that ends.",
  hint: "Open the bitemporal map and drag the crosshair. Rectangles that stop part-way up were retracted: that is a correction, not a change in the real world.",
  queries: [
    "(query [:find ?name ?company :where [?p :person/name ?name] [?p :works-at ?c] [?c :company/name ?company]])",
    "(query [:find ?salary ?tx :any-valid-time :where [:alice :salary ?salary] [:alice :db/tx-count ?tx]])",
    "(query [:find ?who ?boss :where [?w :reports-to ?b] [?w :person/name ?who] [?b :person/name ?boss]])",
  ],
  script: `; tx 1-2: Alice's employment history with explicit valid time
(transact {:valid-from "2020-01-01" :valid-to "2023-06-01"}
          [[:alice :works-at :techcorp]])
(transact {:valid-from "2023-06-01"}
          [[:alice :works-at :startupco]])

; tx 3: people and companies
(transact [[:alice :person/name "Alice" {:valid-from "2019-01-01"}]
           [:bob :person/name "Bob" {:valid-from "2019-01-01"}]
           [:carol :person/name "Carol" {:valid-from "2019-01-01"}]
           [:techcorp :company/name "TechCorp" {:valid-from "2005-03-01"}]
           [:startupco :company/name "StartupCo" {:valid-from "2022-09-01"}]])

; tx 4: Bob joins TechCorp, Carol joins StartupCo
(transact {:valid-from "2021-02-01"}
          [[:bob :works-at :techcorp]
           [:carol :works-at :startupco]
           [:bob :reports-to :alice {:valid-from "2021-02-01" :valid-to "2023-06-01"}]])

; tx 5: a wrong salary is recorded
(transact {:valid-from "2023-06-01"} [[:alice :salary 75000]])

; tx 6-7: correction - the salary was really 80000 from the same date
(retract [[:alice :salary 75000]])
(transact {:valid-from "2023-06-01"} [[:alice :salary 80000]])

; tx 8-9: Carol leaves StartupCo - close the open-ended fact
(retract [[:carol :works-at :startupco]])
(transact {:valid-from "2021-02-01" :valid-to "2024-09-30"}
          [[:carol :works-at :startupco]])

; tx 10: Carol starts at TechCorp, Bob now reports to Carol
(transact {:valid-from "2024-11-01"}
          [[:carol :works-at :techcorp]
           [:bob :reports-to :carol]])

; tx 11: a future-dated promotion
(transact {:valid-from "2027-01-01"} [[:alice :title "VP Engineering"]])
`,
};

const agentMemory: Sample = {
  id: "agent-memory",
  title: "Agent memory",
  summary: "An AI agent stores beliefs about a user, learns it was wrong, and keeps an audit trail.",
  hint: "Step through the transaction log. At tx 4 the agent retracts a belief. Scrub back to tx 3 to see exactly what it believed when it made the recommendation.",
  queries: [
    "(query [:find ?pref :where [:user-ana :prefers ?pref]])",
    "(query [:find ?b ?source ?conf :where [?b :belief/about :user-ana] [?b :belief/source ?source] [?b :belief/confidence ?conf]])",
    "(query [:find ?name :where [:user-ana :works-on ?p] [?p :project/name ?name]])",
  ],
  script: `; tx 1: first conversation
(transact {:valid-from "2026-01-10"}
          [[:user-ana :user/name "Ana"]
           [:user-ana :prefers :concise-answers]
           [:user-ana :works-on :proj-atlas]
           [:proj-atlas :project/name "Atlas"]
           [:proj-atlas :project/lang :rust]])

; tx 2: the agent infers a preference from one message
(transact {:valid-from "2026-01-12"}
          [[:user-ana :prefers :python-examples]
           [:belief-1 :belief/about :user-ana]
           [:belief-1 :belief/source "inferred from chat 2"]
           [:belief-1 :belief/confidence 0.55]])

; tx 3: the agent records a recommendation it made
(transact {:valid-from "2026-01-15"}
          [[:rec-1 :rec/for :user-ana]
           [:rec-1 :rec/text "Use the Python bindings for Atlas"]
           [:rec-1 :rec/based-on :belief-1]])

; tx 4: Ana says she never asked for Python - retract the belief
(retract [[:user-ana :prefers :python-examples]])

; tx 5: record the corrected belief, back-dated to when it was actually true
(transact {:valid-from "2026-01-10"}
          [[:user-ana :prefers :rust-examples]
           [:belief-2 :belief/about :user-ana]
           [:belief-2 :belief/source "user correction"]
           [:belief-2 :belief/confidence 0.95]
           [:belief-2 :belief/supersedes :belief-1]])

; tx 6: Ana moves to a new project from February
(transact {:valid-from "2026-02-01"}
          [[:user-ana :works-on :proj-borealis]
           [:proj-borealis :project/name "Borealis"]
           [:proj-borealis :project/lang :typescript]])

; tx 7-8: close the Atlas assignment at the real end date
(retract [[:user-ana :works-on :proj-atlas]])
(transact {:valid-from "2026-01-10" :valid-to "2026-02-01"}
          [[:user-ana :works-on :proj-atlas]])
`,
};

const orderFsm: Sample = {
  id: "order-fsm",
  title: "Order state machine",
  summary: "Legal transitions stored as facts; an order moves through its lifecycle one transaction at a time.",
  hint: "Press play. Watch the :fsm/state edge of :order-42 jump between states while the transition graph stays fixed.",
  queries: [
    "(query [:find ?order ?state :where [?order :fsm/state ?state]])",
    "(query [:find ?event ?to :where [:order-42 :fsm/state ?s] [?t :transition/from ?s] [?t :transition/event ?event] [?t :transition/to ?to]])",
    "(query [:find (count ?o) :where [?o :fsm/state :delivered]])",
  ],
  script: `; tx 1: the state machine itself
(transact {:valid-from "2026-03-01"}
          [[:t-pay :transition/from :awaiting-payment]
           [:t-pay :transition/to :paid]
           [:t-pay :transition/event :payment-received]
           [:t-ship :transition/from :paid]
           [:t-ship :transition/to :shipped]
           [:t-ship :transition/event :shipment-sent]
           [:t-deliver :transition/from :shipped]
           [:t-deliver :transition/to :delivered]
           [:t-deliver :transition/event :carrier-confirmed]
           [:t-cancel :transition/from :awaiting-payment]
           [:t-cancel :transition/to :cancelled]
           [:t-cancel :transition/event :customer-cancelled]])

; tx 2: a new order
(transact {:valid-from "2026-03-02T09:00:00Z"}
          [[:order-42 :order/customer "Dana"]
           [:order-42 :order/total 129]
           [:order-42 :fsm/state :awaiting-payment]])

; tx 3-4: payment arrives
(retract [[:order-42 :fsm/state :awaiting-payment]])
(transact {:valid-from "2026-03-02T09:20:00Z"} [[:order-42 :fsm/state :paid]])

; tx 5-6: shipped
(retract [[:order-42 :fsm/state :paid]])
(transact {:valid-from "2026-03-03T14:00:00Z"} [[:order-42 :fsm/state :shipped]])

; tx 7: a second order
(transact {:valid-from "2026-03-04T10:00:00Z"}
          [[:order-43 :order/customer "Eli"]
           [:order-43 :order/total 42]
           [:order-43 :fsm/state :awaiting-payment]])

; tx 8-9: order 43 is cancelled
(retract [[:order-43 :fsm/state :awaiting-payment]])
(transact {:valid-from "2026-03-04T12:30:00Z"} [[:order-43 :fsm/state :cancelled]])

; tx 10-11: order 42 delivered
(retract [[:order-42 :fsm/state :shipped]])
(transact {:valid-from "2026-03-06T16:45:00Z"} [[:order-42 :fsm/state :delivered]])
`,
};

const dependencies: Sample = {
  id: "dependencies",
  title: "Dependency upgrades",
  summary: "A service's dependency graph changes release by release. Ask what it looked like at any release.",
  hint: "Use the query console with the time cursor pinned: the same query returns the dependency set of whatever release you scrub to.",
  queries: [
    "(query [:find ?name :where [:myapp :depends-on ?d] [?d :pkg/name ?name]])",
    "(query [:find ?name :where (dep :myapp ?d) [?d :pkg/name ?name]])",
    "(query [:find ?pkg ?sev :where [?c :cve/affects ?p] [?c :cve/severity ?sev] (dep :myapp ?p) [?p :pkg/name ?pkg]])",
  ],
  // Minigraf 2.x can merge two values of one attribute on one entity written in
  // the same transact or retract (minigraf#371), so each :depends-on value of
  // the same package goes in its own call.
  script: `; tx 1-2: v1 dependency graph
(transact {:valid-from "2025-01-15"}
          [[:myapp :pkg/name "myapp"]
           [:myapp :depends-on :requests-2-28]
           [:requests-2-28 :pkg/name "requests 2.28"]
           [:requests-2-28 :depends-on :urllib3-1-26]
           [:urllib3-1-26 :pkg/name "urllib3 1.26"]])
(transact {:valid-from "2025-01-15"}
          [[:myapp :depends-on :pydantic-1-10]
           [:pydantic-1-10 :pkg/name "pydantic 1.10"]])

; tx 3-4: add a web framework
(transact {:valid-from "2025-03-01"}
          [[:myapp :depends-on :fastapi-0-95]
           [:fastapi-0-95 :pkg/name "fastapi 0.95"]
           [:fastapi-0-95 :depends-on :pydantic-1-10]
           [:starlette-0-26 :pkg/name "starlette 0.26"]])
(transact {:valid-from "2025-03-01"}
          [[:fastapi-0-95 :depends-on :starlette-0-26]])

; tx 5: record a known vulnerability
(transact {:valid-from "2025-04-10"}
          [[:cve-2025-001 :cve/affects :urllib3-1-26]
           [:cve-2025-001 :cve/severity "high"]])

; tx 6-8: upgrade pydantic 1 -> 2 and drop the old fastapi
(retract [[:myapp :depends-on :pydantic-1-10]
          [:fastapi-0-95 :depends-on :pydantic-1-10]])
(retract [[:myapp :depends-on :fastapi-0-95]])
(transact {:valid-from "2025-06-01"}
          [[:myapp :depends-on :pydantic-2-0]
           [:pydantic-2-0 :pkg/name "pydantic 2.0"]
           [:fastapi-0-110 :pkg/name "fastapi 0.110"]
           [:fastapi-0-110 :depends-on :pydantic-2-0]
           [:starlette-0-36 :pkg/name "starlette 0.36"]])

; tx 9-10: the new fastapi
(transact {:valid-from "2025-06-01"} [[:myapp :depends-on :fastapi-0-110]])
(transact {:valid-from "2025-06-01"} [[:fastapi-0-110 :depends-on :starlette-0-36]])

; tx 11-12: patch urllib3 for the CVE
(retract [[:requests-2-28 :depends-on :urllib3-1-26]])
(transact {:valid-from "2025-06-20"}
          [[:requests-2-28 :depends-on :urllib3-2-2]
           [:urllib3-2-2 :pkg/name "urllib3 2.2"]])

; Transitive dependencies as a recursive rule. Rules live in memory only;
; they are not part of the stored history.
(rule [(dep ?a ?b) [?a :depends-on ?b]])
(rule [(dep ?a ?c) [?a :depends-on ?b] (dep ?b ?c)])
`,
};

const catalog: Sample = {
  id: "catalog",
  title: "Corestore catalog",
  summary: "The Minigraf tutorial store: a category tree and products whose prices change over time.",
  hint: "Select a product and look at the inspector: each price is a separate fact version with its own valid-time range.",
  queries: [
    "(query [:find ?name ?price :where [?p :product/name ?name] [?p :product/price ?price]])",
    "(query [:find ?cat (count ?p) :where [?p :product/category ?c] [?c :category/name ?cat]])",
    "(query [:find ?price ?vf ?vt :any-valid-time :where [:laptop-pro :product/price ?price] [:laptop-pro :db/valid-from ?vf] [:laptop-pro :db/valid-to ?vt]])",
  ],
  script: `; tx 1: category hierarchy (from the Minigraf tutorial dataset)
(transact {:valid-from "2024-01-01"}
          [[:cat-electronics :category/name "Electronics"]
           [:cat-laptops :category/name "Laptops"]
           [:cat-laptops :category/parent :cat-electronics]
           [:cat-mobile :category/name "Mobile"]
           [:cat-mobile :category/parent :cat-electronics]
           [:cat-audio :category/name "Audio"]
           [:cat-audio :category/parent :cat-electronics]
           [:cat-headphones :category/name "Headphones"]
           [:cat-headphones :category/parent :cat-audio]
           [:cat-accessories :category/name "Accessories"]
           [:cat-accessories :category/parent :cat-electronics]])

; tx 2: products
(transact {:valid-from "2024-02-01"}
          [[:laptop-pro :product/name "LaptopPro 15"]
           [:laptop-pro :product/category :cat-laptops]
           [:laptop-budget :product/name "BudgetBook 14"]
           [:laptop-budget :product/category :cat-laptops]
           [:phone-x :product/name "PhoneX 12"]
           [:phone-x :product/category :cat-mobile]
           [:headphones-nc :product/name "QuietMax NC"]
           [:headphones-nc :product/category :cat-headphones]
           [:cable-usb :product/name "USB-C Cable"]
           [:cable-usb :product/category :cat-accessories]])

; tx 3: launch prices, valid until the spring sale
(transact [[:laptop-pro :product/price 1299 {:valid-from "2024-02-01" :valid-to "2024-04-01"}]
           [:laptop-budget :product/price 699 {:valid-from "2024-02-01" :valid-to "2024-04-01"}]
           [:phone-x :product/price 799 {:valid-from "2024-02-01"}]
           [:headphones-nc :product/price 349 {:valid-from "2024-02-01"}]
           [:cable-usb :product/price 19 {:valid-from "2024-02-01"}]])

; tx 4: spring sale prices
(transact {:valid-from "2024-04-01" :valid-to "2024-05-01"}
          [[:laptop-pro :product/price 1099]
           [:laptop-budget :product/price 599]])

; tx 5: prices after the sale
(transact {:valid-from "2024-05-01"}
          [[:laptop-pro :product/price 1249]
           [:laptop-budget :product/price 649]])

; tx 6-7: the headphones were mis-categorised; move them retroactively
(retract [[:headphones-nc :product/category :cat-headphones]])
(transact {:valid-from "2024-02-01"}
          [[:headphones-nc :product/category :cat-audio]])

; tx 8: a new category and product
(transact {:valid-from "2024-09-01"}
          [[:cat-wearables :category/name "Wearables"]
           [:cat-wearables :category/parent :cat-electronics]
           [:watch-s :product/name "SmartWatch S"]
           [:watch-s :product/category :cat-wearables]
           [:watch-s :product/price 249]])
`,
};

const corestoreTutorial: Sample = {
  id: "corestore-tutorial",
  title: "Corestore tutorial (wiki)",
  summary: "The dataset from the Minigraf wiki tutorial, sections 1 to 3: the store, orders, a price drop and corrected sale prices.",
  hint: "Transaction numbers match the tutorial. Step to tx 6 to see the price Ben paid, then to tx 12 and open the map on :laptop-pro to see the corrected winter sale price.",
  queries: [
    "(query [:find ?price :where [:laptop-pro :product/price ?price]])",
    "(query [:find ?sale :valid-at \"2026-01-15\" :where [:laptop-pro :product/sale-price ?sale]])",
    "(query [:find ?sale ?vf ?vt :any-valid-time :where [:laptop-pro :product/sale-price ?sale] [:laptop-pro :db/valid-from ?vf] [:laptop-pro :db/valid-to ?vt]])",
  ],
  // Copied from demos/tutorial_corestore_setup.txt in the minigraf repo and the
  // wiki pages Tutorial-01 to Tutorial-03, so transaction numbers match the text.
  script: `# ================================================================
# Corestore Tutorial Dataset
# ================================================================
# Base setup for the Minigraf Datalog tutorial series.
# All tutorial sections assume this has been loaded first.
#
# Run with: cargo run < demos/tutorial_corestore_setup.txt
#
# After loading: tx_count = 3
# ================================================================

# ── tx 1: Category hierarchy ─────────────────────────────────────
# Electronics
#   ├── Laptops
#   ├── Mobile
#   ├── Audio
#   │   └── Headphones
#   │       └── Noise-Cancelling
#   └── Accessories

(transact [
  [:cat-electronics :category/name "Electronics"]
  [:cat-laptops     :category/name "Laptops"]
  [:cat-laptops     :category/parent :cat-electronics]
  [:cat-mobile      :category/name "Mobile"]
  [:cat-mobile      :category/parent :cat-electronics]
  [:cat-audio       :category/name "Audio"]
  [:cat-audio       :category/parent :cat-electronics]
  [:cat-headphones  :category/name "Headphones"]
  [:cat-headphones  :category/parent :cat-audio]
  [:cat-nc          :category/name "Noise-Cancelling"]
  [:cat-nc          :category/parent :cat-headphones]
  [:cat-accessories :category/name "Accessories"]
  [:cat-accessories :category/parent :cat-electronics]
])

# ── tx 2: Product catalog ─────────────────────────────────────────
# Two products per major leaf category for window function examples.

(transact [
  [:laptop-pro    :product/name "LaptopPro 15"]
  [:laptop-pro    :product/sku "LP-15"]
  [:laptop-pro    :product/price 1299]
  [:laptop-pro    :product/category :cat-laptops]

  [:laptop-budget :product/name "BudgetBook 14"]
  [:laptop-budget :product/sku "LB-14"]
  [:laptop-budget :product/price 699]
  [:laptop-budget :product/category :cat-laptops]

  [:phone-x       :product/name "PhoneX 12"]
  [:phone-x       :product/sku "PX-12"]
  [:phone-x       :product/price 799]
  [:phone-x       :product/category :cat-mobile]

  [:phone-prev    :product/name "PhoneX 11"]
  [:phone-prev    :product/sku "PX-11"]
  [:phone-prev    :product/price 599]
  [:phone-prev    :product/category :cat-mobile]

  [:nc-headphones :product/name "NoiseCancel Pro"]
  [:nc-headphones :product/sku "NC-PRO"]
  [:nc-headphones :product/price 249]
  [:nc-headphones :product/category :cat-nc]

  [:usb-cable     :product/name "USB-C Cable 2m"]
  [:usb-cable     :product/sku "USB-C-2M"]
  [:usb-cable     :product/price 19]
  [:usb-cable     :product/category :cat-accessories]

  [:keyboard-k1   :product/name "Compact Keyboard"]
  [:keyboard-k1   :product/sku "KB-K1"]
  [:keyboard-k1   :product/price 89]
  [:keyboard-k1   :product/category :cat-accessories]

  [:monitor-27    :product/name "ClearView 27\\" Monitor"]
  [:monitor-27    :product/sku "CV-27"]
  [:monitor-27    :product/price 449]
  [:monitor-27    :product/category :cat-electronics]
])

# ── tx 3: Customers ───────────────────────────────────────────────

(transact [
  [:alice :customer/name "Alice"]
  [:alice :customer/email "alice@example.com"]
  [:ben   :customer/name "Ben"]
  [:ben   :customer/email "ben@example.com"]
  [:clara :customer/name "Clara"]
  [:clara :customer/email "clara@example.com"]
])

; ---- Tutorial 1 (tx 4-5) ----
; tx 4: Alice's first order
(transact [
  [:alice-order-1        :order/customer :alice]
  [:alice-order-1        :order/status :placed]
  [:alice-order-1-item-1 :order-item/order :alice-order-1]
  [:alice-order-1-item-1 :order-item/product :phone-x]
  [:alice-order-1-item-1 :order-item/qty 1]
  [:alice-order-1-item-1 :order-item/price 799]
  [:alice-order-1-item-2 :order-item/order :alice-order-1]
  [:alice-order-1-item-2 :order-item/product :usb-cable]
  [:alice-order-1-item-2 :order-item/qty 1]
  [:alice-order-1-item-2 :order-item/price 19]
])
; tx 5: Alice cancels the USB cable
(retract [
  [:alice-order-1-item-2 :order-item/order :alice-order-1]
  [:alice-order-1-item-2 :order-item/product :usb-cable]
  [:alice-order-1-item-2 :order-item/qty 1]
  [:alice-order-1-item-2 :order-item/price 19]
])

; ---- Tutorial 2 (tx 6-8) ----
; tx 6: Ben places his order
(transact [
  [:ben-order-1        :order/customer :ben]
  [:ben-order-1        :order/status :placed]
  [:ben-order-1-item-1 :order-item/order :ben-order-1]
  [:ben-order-1-item-1 :order-item/product :laptop-pro]
  [:ben-order-1-item-1 :order-item/qty 1]
  [:ben-order-1-item-1 :order-item/price-at-purchase 1299]
])
; tx 7: remove the old price
(retract [[:laptop-pro :product/price 1299]])

; tx 8: record the new price
(transact [[:laptop-pro :product/price 1259]])

; ---- Tutorial 3 (tx 9-12) ----
; tx 9: Winter sale price — valid Jan 1 through Feb 28
(transact {:valid-from "2026-01-01" :valid-to "2026-02-28"}
          [[:laptop-pro :product/sale-price 1099]])

; tx 10: Spring sale price — valid May 20 through Jun 30
(transact {:valid-from "2026-05-20" :valid-to "2026-06-30"}
          [[:laptop-pro :product/sale-price 1149]])
; tx 11: Retract the wrong winter sale price
(retract [[:laptop-pro :product/sale-price 1099]])

; tx 12: Record the correct winter sale price — same valid window
(transact {:valid-from "2026-01-01" :valid-to "2026-02-28"}
          [[:laptop-pro :product/sale-price 1049]])
`,
};

export const SAMPLES: Sample[] = [careers, agentMemory, orderFsm, dependencies, catalog, corestoreTutorial];

export function sampleById(id: string): Sample | undefined {
  return SAMPLES.find((s) => s.id === id);
}
