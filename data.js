/* Stonehill Smart Bus Dashboard — simulated sample data
   Coordinates around Stonehill International School, Tarahunise, Bengaluru */

const SCHOOL = {
  name: "Stonehill International School",
  short: "Stonehill School",
  ll: [13.170998, 77.596295],
  address: "Tarahunise Post, Jala Hobli, Bengaluru North 562 157"
};

const FREE_SPEED = 7.8;          // m/s, planned/free-flow speed (~28 km/h)
const TRAFFIC_SPEED = { green: 8.6, yellow: 5.2, red: 2.6 }; // m/s
const TIME_SCALE = 6;            // demo speed: sim runs 6x faster than real time
const TICK_MS = 2000;

const TRAFFIC_META = {
  green:  { label: "Clear",    color: "#16A34A" },
  yellow: { label: "Moderate", color: "#F59E0B" },
  red:    { label: "Heavy",    color: "#DC2626" }
};

const STATUS_META = {
  ontime:  { label: "On Time",  color: "#16A34A" },
  delayed: { label: "Delayed",  color: "#F59E0B" },
  arriving:{ label: "Arriving", color: "#2563EB" },
  arrived: { label: "Arrived",  color: "#0B5FD9" }
};

/* Each route: stops = polyline vertices (last stop = school).
   traffic[i] applies to the segment between stop i and stop i+1. */
const ROUTES = [
  {
    id: 1, code: "R1", name: "Whitefield", color: "#0B5FD9",
    stops: [
      { n: "Whitefield", ll: [12.9698, 77.7499] },
      { n: "Hope Farm Junction", ll: [12.9780, 77.7520] },
      { n: "Kadugodi", ll: [12.9990, 77.7600] },
      { n: "Seegehalli", ll: [13.0220, 77.7740] },
      { n: "Budigere Cross", ll: [13.0460, 77.7440] },
      { n: "Hunasamaranahalli", ll: [13.1445, 77.5950] },
      { n: "Jala Hobli Office", ll: [13.1620, 77.5955] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["green", "yellow", "green", "red", "yellow", "green", "green"],
    alt: {
      name: "Whitefield Express (via ORR)",
      stops: [
        { n: "Whitefield", ll: [12.9698, 77.7499] },
        { n: "Kadugodi", ll: [12.9990, 77.7600] },
        { n: "Budigere Cross", ll: [13.0460, 77.7440] },
        { n: "Jala Hobli Office", ll: [13.1620, 77.5955] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["green", "green", "green", "green"]
    }
  },
  {
    id: 2, code: "R2", name: "Sarjapur Road", color: "#7C3AED",
    stops: [
      { n: "Sarjapur Road", ll: [12.9063, 77.6822] },
      { n: "Kaikondrahalli", ll: [12.9140, 77.6800] },
      { n: "Bellandur", ll: [12.9260, 77.6760] },
      { n: "Devarabisanahalli", ll: [12.9310, 77.6780] },
      { n: "Marathahalli Bridge", ll: [12.9550, 77.6980] },
      { n: "KR Puram", ll: [12.9716, 77.5946] },
      { n: "Bommenahalli", ll: [13.1535, 77.5948] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["green", "green", "yellow", "yellow", "red", "yellow", "green"],
    alt: {
      name: "Sarjapur Express (via SH 35)",
      stops: [
        { n: "Sarjapur Road", ll: [12.9063, 77.6822] },
        { n: "Bellandur", ll: [12.9260, 77.6760] },
        { n: "Marathahalli Bridge", ll: [12.9550, 77.6980] },
        { n: "Bommenahalli", ll: [13.1535, 77.5948] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["green", "yellow", "yellow", "green"]
    }
  },
  {
    id: 3, code: "R3", name: "Marathahalli", color: "#DC2626",
    stops: [
      { n: "Marathahalli", ll: [12.9562, 77.7019] },
      { n: "Brookefield", ll: [12.9660, 77.7160] },
      { n: "Varthur", ll: [12.9390, 77.7350] },
      { n: "Whitefield Main Road", ll: [12.9698, 77.7499] },
      { n: "ITPL", ll: [12.9790, 77.7100] },
      { n: "KR Puram", ll: [12.9716, 77.5946] },
      { n: "Bommenahalli", ll: [13.1535, 77.5948] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["red", "red", "yellow", "yellow", "green", "yellow", "green"],
    alt: {
      name: "Marathahalli Bypass",
      stops: [
        { n: "Marathahalli", ll: [12.9562, 77.7019] },
        { n: "Brookefield", ll: [12.9660, 77.7160] },
        { n: "Bommenahalli", ll: [13.1535, 77.5948] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["red", "yellow", "green"]
    }
  },
  {
    id: 4, code: "R4", name: "Indiranagar", color: "#0D9488",
    stops: [
      { n: "Indiranagar", ll: [12.9719, 77.6412] },
      { n: "CMH Road", ll: [12.9780, 77.6380] },
      { n: "Domlur", ll: [12.9620, 77.6380] },
      { n: "HAL Airport Road", ll: [12.9510, 77.6680] },
      { n: "Marathahalli", ll: [12.9562, 77.7019] },
      { n: "Bommenahalli", ll: [13.1535, 77.5948] },
      { n: "Jala Hobli Office", ll: [13.1620, 77.5955] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["green", "yellow", "yellow", "red", "yellow", "green", "green"],
    alt: {
      name: "Indiranagar Inner Ring Road",
      stops: [
        { n: "Indiranagar", ll: [12.9719, 77.6412] },
        { n: "Domlur", ll: [12.9620, 77.6380] },
        { n: "Bommenahalli", ll: [13.1535, 77.5948] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["green", "green", "green"]
    }
  },
  {
    id: 5, code: "R5", name: "KR Puram", color: "#EA580C",
    stops: [
      { n: "KR Puram", ll: [12.9716, 77.5946] },
      { n: "Mahadevapura", ll: [12.9910, 77.6860] },
      { n: "Benniganahalli", ll: [12.9950, 77.6610] },
      { n: "OAR Junction", ll: [13.0110, 77.5540] },
      { n: "Nagavara", ll: [13.0430, 77.6260] },
      { n: "Hennur Cross", ll: [13.0400, 77.6550] },
      { n: "Bommenahalli", ll: [13.1535, 77.5948] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["green", "yellow", "yellow", "red", "yellow", "green", "green"],
    alt: {
      name: "KR Puram ORR Bypass",
      stops: [
        { n: "KR Puram", ll: [12.9716, 77.5946] },
        { n: "Mahadevapura", ll: [12.9910, 77.6860] },
        { n: "Bommenahalli", ll: [13.1535, 77.5948] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["green", "yellow", "green"]
    }
  },
  {
    id: 6, code: "R6", name: "Electronic City", color: "#DB2777",
    stops: [
      { n: "Electronic City Phase 1", ll: [12.8440, 77.6600] },
      { n: "Electronic City Phase 2", ll: [12.8300, 77.6900] },
      { n: "Silk Board", ll: [12.9177, 77.6227] },
      { n: "BTM Layout", ll: [12.9166, 77.6101] },
      { n: "Koramangala", ll: [12.9352, 77.6245] },
      { n: "Domlur", ll: [12.9620, 77.6380] },
      { n: "Bommenahalli", ll: [13.1535, 77.5948] },
      { n: "Stonehill School", ll: [13.170998, 77.596295] }
    ],
    traffic: ["green", "yellow", "red", "yellow", "yellow", "green", "green"],
    alt: {
      name: "Electronic City Express",
      stops: [
        { n: "Electronic City Phase 1", ll: [12.8440, 77.6600] },
        { n: "Silk Board", ll: [12.9177, 77.6227] },
        { n: "Koramangala", ll: [12.9352, 77.6245] },
        { n: "Bommenahalli", ll: [13.1535, 77.5948] },
        { n: "Stonehill School", ll: [13.170998, 77.596295] }
      ],
      traffic: ["green", "yellow", "yellow", "green"]
    }
  }
];



/* students: "Name|Class|stopIndex"  — "|absent" suffix seeds an absent student */
const BUSES = [
  {
    id: 1, name: "Bus 1", routeId: 1, driver: "Rajesh Kumar", phone: "+91 98450 21184",
    capacity: 40, progress: 0.30, delay: 6,
    students: [
      "Aarav Sharma|Grade 1|0", "Diya Menon|Grade 1|1", "Kabir Nair|Grade 2|1",
      "Ishita Rao|Grade 2|2", "Vihaan Gupta|Grade 3|2", "Sara Fernandes|Grade 3|3|absent",
      "Arjun Iyer|Grade 4|3", "Ananya Deshpande|Grade 4|4", "Rohan Bhat|Grade 5|4",
      "Meera Krishnan|Grade 5|5", "Aditya Subramani|Grade 6|5", "Tanvi Shetty|Grade 7|6",
      "Neel Joshi|Grade 7|6", "Zara Qureshi|Grade 8|7|absent", "Vivaan Reddy|Grade 9|2",
      "Riya Kapoor|Grade 10|5"
    ]
  },
  {
    id: 2, name: "Bus 2", routeId: 2, driver: "Suresh Babu", phone: "+91 98860 43312",
    capacity: 40, progress: 0.18, delay: 1,
    students: [
      "Aadhya Pillai|Grade 1|0", "Reyansh Kumar|Grade 1|1", "Myra Chawla|Grade 2|1",
      "Dev Anand|Grade 2|2", "Kiara Singh|Grade 3|3", "Ashwin Prakash|Grade 3|3",
      "Nisha Verma|Grade 4|4|absent", "Yash Chandra|Grade 4|4", "Samaira Gill|Grade 5|5",
      "Om Deshmukh|Grade 6|5", "Tara Mohan|Grade 6|6", "Krishna Pai|Grade 7|6",
      "Simran Kaur|Grade 8|7", "Advait Limaye|Grade 9|2|absent", "Hana Thomas|Grade 10|6"
    ]
  },
  {
    id: 3, name: "Bus 3", routeId: 3, driver: "Mohammed Irfan", phone: "+91 99012 77456",
    capacity: 40, progress: 0.35, delay: 12,
    students: [
      "Vihaan Agarwal|Grade 1|0", "Aisha Khan|Grade 1|1", "Liam D'Souza|Grade 2|1",
      "Anika Bose|Grade 2|2", "Samar Joshi|Grade 3|2", "Navya Holla|Grade 3|3",
      "Ethan Sequeira|Grade 4|3", "Prisha Kamath|Grade 4|4", "Rudra Prasad|Grade 5|4|absent",
      "Amaira Sheikh|Grade 5|5", "Shaurya Tiwari|Grade 6|5", "Ira Kulkarni|Grade 7|6",
      "Ayaan Mirza|Grade 8|6", "Sanya Pillai|Grade 9|3|absent", "Dhruv Ramesh|Grade 10|4",
      "Naomi Elizabeth|Grade 10|5"
    ]
  },
  {
    id: 4, name: "Bus 4", routeId: 4, driver: "Venkatesh Reddy", phone: "+91 97400 55821",
    capacity: 40, progress: 0.42, delay: 3,
    students: [
      "Arnav Hegde|Grade 1|0", "Saanvi Kulkarni|Grade 1|1", "Aryan Bakshi|Grade 2|2",
      "Myra Nathan|Grade 2|2", "Veer Mahajan|Grade 3|3", "Diya Suresh|Grade 3|3",
      "Kiaan Mehta|Grade 4|4", "Rhea Dcunha|Grade 4|4|absent", "Sooraj Menon|Grade 5|4",
      "Alia Fernandes|Grade 5|5", "Aarush Gowda|Grade 6|5", "Pari Shukla|Grade 7|5",
      "Ritvik Rao|Grade 8|6", "Mira Antony|Grade 9|6", "Zain Ali|Grade 10|6|absent"
    ]
  },
  {
    id: 5, name: "Bus 5", routeId: 5, driver: "Prakash Naik", phone: "+91 96325 10097",
    capacity: 40, progress: 0.12, delay: 0,
    students: [
      "Vedant Shetty|Grade 1|0", "Anvi Ranjan|Grade 1|0", "Rahul Dev|Grade 2|1",
      "Sarah Mathew|Grade 2|1", "Ishaan Bedi|Grade 3|2", "Trisha Naik|Grade 3|2",
      "Kabir Sood|Grade 4|3", "Nandini Rai|Grade 4|3|absent", "Armaan Kapoor|Grade 5|3",
      "Lavya Jain|Grade 6|3", "Tanish Ahuja|Grade 7|4", "Siya Dutta|Grade 8|4",
      "Harsh Vardhan|Grade 9|4", "Elena Maria|Grade 10|4|absent"
    ]
  },
  {
    id: 6, name: "Bus 6", routeId: 6, driver: "Manjunath H. S.", phone: "+91 98448 30625",
    capacity: 40, progress: 0.88, delay: 2,
    students: [
      "Ayaan Khan|Grade 1|0", "Mysha Rizwan|Grade 1|1", "Ritika Sinha|Grade 2|1",
      "Samar Goel|Grade 2|2", "Aarav Jha|Grade 3|2", "Nitya Jain|Grade 3|3",
      "Aneesh Varma|Grade 4|3|absent", "Alisha Paul|Grade 4|3", "Om Prakash|Grade 5|3",
      "Vanya Raina|Grade 6|4", "Zorawar Singh|Grade 7|4", "Aiza Noor|Grade 8|4",
      "Tejas Kini|Grade 9|3", "Oviya Balan|Grade 10|4|absent"
    ]
  }
];

const SEED_ALERTS = [
  { type: "danger", text: "Bus 3 delayed by 12 minutes due to heavy traffic on Hebbal Junction." },
  { type: "danger", text: "Heavy traffic reported on R3 (Hebbal / Jakkur) — 4 segments congested." },
  { type: "warn", text: "Bus 1 delayed by 6 minutes — slow moving traffic near Hunasamaranahalli." },
  { type: "info", text: "Bus 6 arriving at Stonehill School — 2 min to final stop." },
  { type: "info", text: "Morning transport check complete · 6 buses dispatched." }
];
