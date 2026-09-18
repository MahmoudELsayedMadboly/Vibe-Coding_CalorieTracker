import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, Trash2, Check, AlertTriangle, TrendingDown, Save, Home, Users, ClipboardList, Bell, Settings, MessageSquare, Pencil, X, Send } from "lucide-react";
import { supabase } from "./supabaseClient";

const INK = "#1B2430";
const INK_SOFT = "#5B6472";
const PAPER = "#F5F6F1";
const PANEL = "#FFFFFF";
const GRID = "#DDE1D6";
const TEAL = "#146B6B";
const TEAL_SOFT = "#DCEAE8";
const GREEN = "#3C7A42";
const GREEN_SOFT = "#E4EFE1";
const AMBER = "#B4790C";
const AMBER_SOFT = "#F5E9D3";
const RED = "#A13A2E";
const RED_SOFT = "#F5E0DC";

const TOLERANCE = 0.05;

const HISTORY_CHART_HEIGHT = 180;
const HISTORY_COL_WIDTH = 28;
const HISTORY_COL_GAP = 6;

const ACTIVITY_LEVELS = [
  { id: "sedentary", label: "Sedentary", mult: 1.2 },
  { id: "light", label: "Lightly active", mult: 1.375 },
  { id: "moderate", label: "Moderately active", mult: 1.55 },
  { id: "active", label: "Active", mult: 1.725 },
  { id: "very_active", label: "Very active", mult: 1.9 },
];

const RATES = [
  { id: "mild", label: "Mild", kcal: 250 },
  { id: "moderate", label: "Moderate", kcal: 500 },
  { id: "aggressive", label: "Aggressive", kcal: 750 },
];

const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack", "Before training", "After training"];
const COURSES = ["Main", "Side1", "Side2", "Drink", "Dessert"];

const MEASUREMENT_FIELDS = [
  { key: "neck", label: "Neck" },
  { key: "waist", label: "Waist" },
  { key: "shoulder", label: "Shoulder" },
  { key: "chest", label: "Chest" },
  { key: "abdomen", label: "Abdomen" },
  { key: "thighs", label: "Thighs" },
];

function draftKey(userId) {
  return `calorie-tracker-draft-${userId}`;
}

function saveDraft(userId, data) {
  try {
    sessionStorage.setItem(draftKey(userId), JSON.stringify(data));
  } catch (err) {
    console.error("Draft save error:", err);
  }
}

function loadDraft(userId) {
  try {
    const raw = sessionStorage.getItem(draftKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Draft load error:", err);
    return null;
  }
}

function clearDraft(userId) {
  try {
    sessionStorage.removeItem(draftKey(userId));
  } catch (err) {
    console.error("Draft clear error:", err);
  }
}

// Local calendar date (not UTC) — <input type="date"> works in the browser's
// local timezone, so using toISOString() here can shift the date by a day
// and desync it from the min/max the picker actually enforces.
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return localDateStr(new Date());
}

function threeDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return localDateStr(d);
}

function generateLinkCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Pure calendar-date arithmetic on "YYYY-MM-DD" strings, done in UTC so DST
// shifts in the local timezone can't push the result onto the wrong day.
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysStr(s, days) {
  const d = parseDateStr(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenStr(a, b) {
  return Math.round((parseDateStr(b) - parseDateStr(a)) / 86400000);
}

// Whole years between a "YYYY-MM-DD" date of birth and today, done in UTC
// for the same DST-safety reason as the other calendar-date helpers above.
function calcAgeFromDOB(dobStr) {
  if (!dobStr) return null;

  const dob = parseDateStr(dobStr);
  const now = parseDateStr(todayStr());

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }

  return age;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDayLabel(s) {
  const [, m, d] = s.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${d}`;
}

function computeBMI(profile) {
  const weight = Number(profile.weightKg) || 0;
  const heightM = (Number(profile.heightCm) || 0) / 100;

  if (weight <= 0 || heightM <= 0) {
    return null;
  }

  const bmi = weight / (heightM * heightM);
  const normalMin = 18.5 * heightM * heightM;
  const normalMax = 24.9 * heightM * heightM;

  let category;
  let status;

  if (bmi < 18.5) {
    category = "Underweight";
    status = "yellow";
  } else if (bmi < 25) {
    category = "Normal weight";
    status = "green";
  } else if (bmi < 30) {
    category = "Overweight";
    status = "red";
  } else if (bmi < 35) {
    category = "Obese (Class I)";
    status = "red";
  } else if (bmi < 40) {
    category = "Obese (Class II)";
    status = "red";
  } else {
    category = "Obese (Class III)";
    status = "red";
  }

  let percentDiff = 0;
  let diffLabel = "within";

  if (weight > normalMax) {
    percentDiff = ((weight - normalMax) / normalMax) * 100;
    diffLabel = "above";
  } else if (weight < normalMin) {
    percentDiff = ((normalMin - weight) / normalMin) * 100;
    diffLabel = "below";
  }

  let sentence;

  if (status === "green") {
    sentence = "Your BMI falls within the standard weight range for your height.";
  } else if (diffLabel === "above") {
    sentence = `Your weight is about ${percentDiff.toFixed(1)}% above the standard range for your height (${category.toLowerCase()}). A structured plan aimed at gradual, steady loss can help bring it back within range.`;
  } else {
    sentence = `Your weight is about ${percentDiff.toFixed(1)}% below the standard range for your height (${category.toLowerCase()}). A plan aimed at gradual, healthy weight gain can help bring it within range.`;
  }

  return { bmi, category, status, percentDiff, diffLabel, sentence };
}

function computePlan(profile, goal) {
  const weight = Number(profile.weightKg) || 0;
  const height = Number(profile.heightCm) || 0;
  const age = Number(profile.age) || 0;

  let bmr;

  if (profile.sex === "male") {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const activityInfo = ACTIVITY_LEVELS.find((a) => a.id === profile.activity) || ACTIVITY_LEVELS[2];
  const tdee = bmr * activityInfo.mult;

  let targetCalories = tdee;

  if (goal.type === "cut" || goal.type === "bulk") {
    const rateInfo = RATES.find((r) => r.id === goal.rate) || RATES[1];
    const sign = goal.type === "cut" ? -1 : 1;
    targetCalories = tdee + sign * rateInfo.kcal;
  }

  let proteinPerKg;

  if (goal.type === "cut") {
    proteinPerKg = 2.0;
  } else if (goal.type === "bulk") {
    proteinPerKg = 1.8;
  } else {
    proteinPerKg = 1.6;
  }

  const proteinG = Math.round(weight * proteinPerKg);
  const fatG = Math.round((targetCalories * 0.27) / 9);
  const carbG = Math.round(Math.max(targetCalories - proteinG * 4 - fatG * 9, 0) / 4);

  return {
    calories: Math.round(targetCalories),
    protein: proteinG,
    carbs: carbG,
    fat: fatG,
  };
}

const COUNTRY_DIAL_CODES = [
  { label: "Egypt", code: "+20" },
  { label: "Saudi Arabia", code: "+966" },
  { label: "UAE", code: "+971" },
  { label: "Kuwait", code: "+965" },
  { label: "Qatar", code: "+974" },
  { label: "Bahrain", code: "+973" },
  { label: "Oman", code: "+968" },
  { label: "Jordan", code: "+962" },
  { label: "Lebanon", code: "+961" },
  { label: "Iraq", code: "+964" },
  { label: "Syria", code: "+963" },
  { label: "Yemen", code: "+967" },
  { label: "Libya", code: "+218" },
  { label: "Tunisia", code: "+216" },
  { label: "Algeria", code: "+213" },
  { label: "Morocco", code: "+212" },
  { label: "Sudan", code: "+249" },
  { label: "Palestine", code: "+970" },
  { label: "United States/Canada", code: "+1" },
  { label: "United Kingdom", code: "+44" },
  { label: "Germany", code: "+49" },
  { label: "France", code: "+33" },
  { label: "Italy", code: "+39" },
  { label: "Spain", code: "+34" },
  { label: "Turkey", code: "+90" },
  { label: "India", code: "+91" },
  { label: "Pakistan", code: "+92" },
  { label: "China", code: "+86" },
  { label: "Russia", code: "+7" },
  { label: "Brazil", code: "+55" },
  { label: "Australia", code: "+61" },
];

function splitPhoneByDialCode(phone) {
  if (!phone) return { code: "+20", number: "" };
  const byLongestCode = [...COUNTRY_DIAL_CODES].sort((a, b) => b.code.length - a.code.length);
  const match = byLongestCode.find((c) => phone.startsWith(c.code));
  if (!match) return { code: "+20", number: phone.replace(/\D/g, "") };
  return { code: match.code, number: phone.slice(match.code.length) };
}

function clientStatusMeta(client) {
  if (!client) return { label: "Invited", color: AMBER, soft: AMBER_SOFT };
  if (client.coachStatus === "inactive") {
    return { label: "Deactivated", color: INK_SOFT, soft: GRID };
  }
  if (client.firstLoginAt) {
    return { label: "Active", color: GREEN, soft: GREEN_SOFT };
  }
  return { label: "Invited", color: AMBER, soft: AMBER_SOFT };
}

function planStatusMeta(status) {
  if (status === "active") return { label: "Active", color: GREEN, soft: GREEN_SOFT };
  if (status === "draft") return { label: "Draft", color: TEAL, soft: TEAL_SOFT };
  if (status === "inactive") return { label: "Inactive", color: INK_SOFT, soft: "#EEEEEC" };
  return { label: "No status yet", color: INK_SOFT, soft: "#EEEEEC" };
}

function PlanStatusBadge({ status }) {
  const meta = planStatusMeta(status);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 4,
        background: meta.soft,
        color: meta.color,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      {meta.label}
    </span>
  );
}

function UnreadBadge({ count }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 16,
        height: 16,
        padding: "0 4px",
        borderRadius: 8,
        background: RED,
        color: "#FFFFFF",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        fontWeight: 700,
        marginLeft: "auto",
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function describeAddClientError(reason) {
  switch (reason) {
    case "not_a_coach":
      return "Your account isn't set up as a coach, so you can't add clients.";
    case "invite_failed":
      return "The invite couldn't be sent. Please try again.";
    case "email_required":
      return "Enter an email address.";
    default:
      return reason ? `Couldn't add client: ${reason}` : "Couldn't add client. Please try again.";
  }
}

function statusFor(actual, target) {
  if (target <= 0) return "green";

  const low = target * (1 - TOLERANCE);
  const high = target * (1 + TOLERANCE);

  if (actual > high) return "red";
  if (actual < low) return "yellow";
  return "green";
}

const STATUS_META = {
  green: { color: GREEN, soft: GREEN_SOFT, label: "On target", icon: Check },
  red: { color: RED, soft: RED_SOFT, label: "Exceeded", icon: AlertTriangle },
  yellow: { color: AMBER, soft: AMBER_SOFT, label: "Below target", icon: TrendingDown },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 4,
        background: meta.soft,
        color: meta.color,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10.5,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
      }}
    >
      <Icon size={11} strokeWidth={2.5} />
      {meta.label}
    </span>
  );
}

function MetricRow({ label, actual, target, unit }) {
  const status = statusFor(actual, target);
  const meta = STATUS_META[status];
  const pct = target > 0 ? Math.min((actual / target) * 100, 160) : 0;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5 }}>
            {Math.round(actual)}
            {unit} <span style={{ color: INK_SOFT }}>/ {Math.round(target)}{unit}</span>
          </span>
          <StatusBadge status={status} />
        </div>
      </div>
      <div style={{ position: "relative", height: 10, background: PAPER, border: `1px solid ${GRID}`, borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            left: `${(100 - TOLERANCE * 100)}%`,
            width: `${TOLERANCE * 2 * 100}%`,
            top: 0,
            bottom: 0,
            background: GREEN_SOFT,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${pct}%`,
            top: 0,
            bottom: 0,
            borderRight: `2px solid ${meta.color}`,
          }}
        />
      </div>
    </div>
  );
}

export default function CalorieTrackerApp() {
  const [session, setSession] = useState(undefined);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState(null);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [setupSavedFlash, setSetupSavedFlash] = useState(false);
  const [view, setView] = useState("setup");
  const [configTab, setConfigTab] = useState("profile");
  const [adminTab, setAdminTab] = useState("planTypes");
  const [notificationSettings, setNotificationSettings] = useState(null);
  const [thresholdPercentDraft, setThresholdPercentDraft] = useState("");
  const telegramPollRef = useRef(null);
  const [roleId, setRoleId] = useState(null);

  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientsError, setClientsError] = useState(null);
  const [clientsView, setClientsView] = useState("grid");
  const [clientsPage, setClientsPage] = useState(1);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [addClientName, setAddClientName] = useState("");
  const [addClientEmail, setAddClientEmail] = useState("");
  const [addClientPhoneCountryCode, setAddClientPhoneCountryCode] = useState("+20");
  const [addClientPhoneNumber, setAddClientPhoneNumber] = useState("");
  const [addClientPlanTypeId, setAddClientPlanTypeId] = useState("");
  const [addClientDateFrom, setAddClientDateFrom] = useState("");
  const [addClientDateTo, setAddClientDateTo] = useState("");
  const [addClientBusy, setAddClientBusy] = useState(false);
  const [addClientMessage, setAddClientMessage] = useState(null);
  const [createdClientCredentials, setCreatedClientCredentials] = useState(null);
  const [editingClientId, setEditingClientId] = useState(null);

  const [clientDetail, setClientDetail] = useState(null);
  const [clientDetailLoading, setClientDetailLoading] = useState(false);
  const [clientDetailError, setClientDetailError] = useState(null);
  const [clientDetailBusy, setClientDetailBusy] = useState(false);
  const [clientDetailFlash, setClientDetailFlash] = useState(null);

  const [planTypes, setPlanTypes] = useState([]);
  const [planTypesLoading, setPlanTypesLoading] = useState(false);
  const [planTypesError, setPlanTypesError] = useState(null);
  const [newPlanTypeName, setNewPlanTypeName] = useState("");
  const [addPlanTypeBusy, setAddPlanTypeBusy] = useState(false);
  const [addPlanTypeError, setAddPlanTypeError] = useState(null);

  const [globalFoods, setGlobalFoods] = useState([]);
  const [globalFoodsLoading, setGlobalFoodsLoading] = useState(false);
  const [globalFoodsError, setGlobalFoodsError] = useState(null);
  const [selectedGlobalFoodIds, setSelectedGlobalFoodIds] = useState([]);
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState(null);

  const [editingFoodId, setEditingFoodId] = useState(null);
  const [editFoodName, setEditFoodName] = useState("");
  const [editFoodCalPer100g, setEditFoodCalPer100g] = useState("");
  const [editFoodError, setEditFoodError] = useState(null);
  const [editFoodBusy, setEditFoodBusy] = useState(false);

  const [plansView, setPlansView] = useState("list");
  const [clientPlanSummaries, setClientPlanSummaries] = useState({});
  const [clientPlanSummariesLoading, setClientPlanSummariesLoading] = useState(false);
  const [clientPlanStatuses, setClientPlanStatuses] = useState({});

  const [planBuilderClientId, setPlanBuilderClientId] = useState(null);
  const [clientPlanFoods, setClientPlanFoods] = useState([]);
  const [clientPlanLoading, setClientPlanLoading] = useState(false);
  const [clientPlanError, setClientPlanError] = useState(null);
  const [clientPlanName, setClientPlanName] = useState("");
  const [clientPlanDateFrom, setClientPlanDateFrom] = useState("");
  const [clientPlanDateTo, setClientPlanDateTo] = useState("");
  const [clientPlanStatus, setClientPlanStatus] = useState(null);
  const [newClientPlanFood, setNewClientPlanFood] = useState({ foodKey: "", grams: "", calories: "", meal: "Breakfast", course: "Main" });
  const [clientPlanAddError, setClientPlanAddError] = useState(null);
  const [clientPlanSaveBusy, setClientPlanSaveBusy] = useState(false);
  const [clientPlanSaveError, setClientPlanSaveError] = useState(null);
  const [clientPlanSendBusy, setClientPlanSendBusy] = useState(false);
  const [clientPlanSendError, setClientPlanSendError] = useState(null);

  const [planDetailsClientId, setPlanDetailsClientId] = useState(null);
  const [planDetailsLoading, setPlanDetailsLoading] = useState(false);
  const [planDetailsError, setPlanDetailsError] = useState(null);
  const [planDetailsFoods, setPlanDetailsFoods] = useState([]);
  const [planDetailsStatus, setPlanDetailsStatus] = useState(null);
  const [planDetailsDeactivateBusy, setPlanDetailsDeactivateBusy] = useState(false);
  const [planDetailsRemoveBusy, setPlanDetailsRemoveBusy] = useState(false);

  const [ownPlanStatus, setOwnPlanStatus] = useState("active");

  const [chatSelectedClientId, setChatSelectedClientId] = useState(null);
  const [myCoachId, setMyCoachId] = useState(null);
  const [myCoachName, setMyCoachName] = useState(null);
  const [myCoachLoading, setMyCoachLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatSendError, setChatSendError] = useState(null);
  const [chatUnreadByClient, setChatUnreadByClient] = useState({});

  const [profile, setProfile] = useState({ sex: "male", age: 30, dateOfBirth: "", healthNotes: "", weightKg: 75, heightCm: 175, activity: "moderate" });

  const [measurements, setMeasurements] = useState([]);
  const [newMeasurement, setNewMeasurement] = useState({ date: todayStr(), neck: "", waist: "", shoulder: "", chest: "", abdomen: "", thighs: "" });
  const [measurementSaving, setMeasurementSaving] = useState(false);
  const [measurementError, setMeasurementError] = useState(null);

  const [photos, setPhotos] = useState([]);
  const [newPhotoDate, setNewPhotoDate] = useState(todayStr());
  const [photoFile, setPhotoFile] = useState(null);
  const photoFileInputRef = useRef(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [goal, setGoal] = useState({ type: "maintain", rate: "moderate" });
  const [planOverride, setPlanOverride] = useState(null);
  const [foods, setFoods] = useState([]);
  const [logs, setLogs] = useState({});
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [logMeal, setLogMeal] = useState("Breakfast");

  const [newFood, setNewFood] = useState({ personalFoodId: "", grams: "", calories: "", meal: "Breakfast", course: "Main" });
  const [addFoodError, setAddFoodError] = useState(null);
  const [personalFoods, setPersonalFoods] = useState([]);
  const [newPersonalFood, setNewPersonalFood] = useState({ name: "", calPer100g: "" });
  const [personalFoodError, setPersonalFoodError] = useState(null);
  const [entryFoodId, setEntryFoodId] = useState("");
  const [customName, setCustomName] = useState("");
  const [entryGrams, setEntryGrams] = useState("");
  const [entryCalPer100g, setEntryCalPer100g] = useState("");
  const [entryError, setEntryError] = useState(null);
  const [savedPlanOverride, setSavedPlanOverride] = useState(null);
  const [planDateFrom, setPlanDateFrom] = useState("");
  const [planDateTo, setPlanDateTo] = useState("");
  const [planName, setPlanName] = useState("");
  const [comparisonDate, setComparisonDate] = useState(todayStr());
  const [tableFilterType, setTableFilterType] = useState("");
  const [tableFilterDateFrom, setTableFilterDateFrom] = useState("");
  const [tableFilterDateTo, setTableFilterDateTo] = useState("");
  const [tableFilterMeal, setTableFilterMeal] = useState("");
  const [tableFilterFood, setTableFilterFood] = useState("");
  const [tablePage, setTablePage] = useState(1);

  const [ideaText, setIdeaText] = useState("");
  const [ideaError, setIdeaError] = useState(null);
  const [ideaFlash, setIdeaFlash] = useState(false);
  const [bugText, setBugText] = useState("");
  const [bugError, setBugError] = useState(null);
  const [bugFlash, setBugFlash] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (telegramPollRef.current) clearInterval(telegramPollRef.current);
    };
  }, []);

  // Keep the draft in sync with the last-saved value, but only when that
  // saved value actually changes (initial load, or our own onBlur save) —
  // never on every keystroke, which would fight the user's typing.
  useEffect(() => {
    setThresholdPercentDraft(notificationSettings?.threshold_percent ?? "");
  }, [notificationSettings?.threshold_percent]);

  function passwordStrengthError(pw) {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
    if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Password must include a number.";
    if (!/[^A-Za-z0-9]/.test(pw)) return "Password must include a special character.";
    return null;
  }

  async function handleAuthSubmit() {
    setAuthError(null);
    setAuthNotice(null);

    if (!authEmail || !authPassword) {
      setAuthError("Enter both an email and a password.");
      return;
    }

    if (authMode === "signup") {
      const strengthError = passwordStrengthError(authPassword);
      if (strengthError) {
        setAuthError(strengthError);
        return;
      }
    }

    setAuthBusy(true);

    try {
      if (authMode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;

        // Supabase returns a "fake" user with no error when the email is already
        // registered and confirmed (this is intentional, to avoid leaking which
        // emails exist). An empty identities array is the documented way to tell.
        if (data && data.user && data.user.identities && data.user.identities.length === 0) {
          setAuthError("This email is already signed up. Please log in instead.");
        } else {
          setAuthNotice("Account created. If email confirmation is required, check your inbox before logging in.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
      }
    } catch (err) {
      setAuthError(err && err.message ? err.message : "Something went wrong.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    if (session && session.user) clearDraft(session.user.id);
    await supabase.auth.signOut();
    setLoaded(false);
  }

  useEffect(() => {
    if (!session) return;

    async function load() {
      const userId = session.user.id;

      try {
        let { data: profileRow, error: profileErr } = await supabase
          .from("profile")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        if (profileErr) throw profileErr;

        if (!profileRow) {
          const { data: legacyProfile, error: legacyErr } = await supabase
            .from("profile")
            .select("*")
            .is("user_id", null)
            .limit(1)
            .maybeSingle();
          if (legacyErr) throw legacyErr;

          if (legacyProfile) {
            // First login ever: claim all unowned legacy rows across every table.
            await supabase.from("profile").update({ user_id: userId }).is("user_id", null);
            await supabase.from("food_list").update({ user_id: userId }).is("user_id", null);
            await supabase.from("plan_foods").update({ user_id: userId }).is("user_id", null);
            await supabase.from("meal_logs").update({ user_id: userId }).is("user_id", null);

            const { data: claimed, error: reErr } = await supabase
              .from("profile")
              .select("*")
              .eq("user_id", userId)
              .maybeSingle();
            if (reErr) throw reErr;
            profileRow = claimed;
          } else {
            const { data: created, error: createErr } = await supabase
              .from("profile")
              .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: false })
              .select()
              .single();
            if (createErr) throw createErr;
            profileRow = created;
          }
        }

        let { data: notifRow, error: notifErr } = await supabase
          .from("notification_settings")
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();
        if (notifErr) throw notifErr;

        if (!notifRow) {
          const { data: createdNotif, error: createNotifErr } = await supabase
            .from("notification_settings")
            .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: false })
            .select()
            .single();
          if (createNotifErr) throw createNotifErr;
          notifRow = createdNotif;
        }

        setNotificationSettings(notifRow);

        console.log("[roleId debug] querying user_info for userId:", userId);

        const { data: userInfoRow, error: userInfoErr } = await supabase
          .from("user_info")
          .select("role_id, first_login_at")
          .eq("id", userId)
          .maybeSingle();

        console.log("[roleId debug] userInfoErr:", userInfoErr);
        console.log("[roleId debug] raw userInfoRow:", userInfoRow);

        if (userInfoErr) throw userInfoErr;

        // A standalone user (no coach) has no client_profile row at all, so
        // their own plan stays effectively "active" by default. Only a
        // coach's client has this row, and only a coach can set it to
        // "draft" or "inactive".
        let ownPlanStatusValue = "active";
        try {
          const { data: selfClientProfileRow } = await supabase
            .from("client_profile")
            .select("plan_status")
            .eq("user_id", userId)
            .maybeSingle();
          if (selfClientProfileRow && selfClientProfileRow.plan_status) {
            ownPlanStatusValue = selfClientProfileRow.plan_status;
          }
        } catch (e) {
          // No client_profile row / not a coach's client — stays "active".
        }
        setOwnPlanStatus(ownPlanStatusValue);

        const [personalFoodsRes, planFoodsRes, logsRes, measurementsRes, photosRes] = await Promise.all([
          supabase.from("food_list").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
          supabase.from("plan_foods").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
          supabase.from("meal_logs").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
          supabase.from("body_measurements").select("*").eq("user_id", userId).order("date", { ascending: false }),
          supabase.from("progress_photos").select("*").eq("user_id", userId).order("taken_at", { ascending: false }),
        ]);

        if (personalFoodsRes.error) throw personalFoodsRes.error;
        if (planFoodsRes.error) throw planFoodsRes.error;
        if (logsRes.error) throw logsRes.error;
        if (measurementsRes.error) throw measurementsRes.error;
        if (photosRes.error) throw photosRes.error;

        const p = profileRow;

        if (p) {
          const dob = p.date_of_birth || "";
          const dobAge = calcAgeFromDOB(dob);

          setProfile({
            sex: p.sex || "male",
            age: dobAge !== null ? dobAge : (p.age ?? 30),
            dateOfBirth: dob,
            healthNotes: p.health_notes || "",
            weightKg: p.weight_kg ?? 75,
            heightCm: p.height_cm ?? 175,
            activity: p.activity || "moderate",
          });
          console.log("[roleId debug] value passed to setRoleId:", userInfoRow?.role_id ?? null);
          setRoleId(userInfoRow?.role_id ?? null);
          setGoal({ type: p.goal_type || "maintain", rate: p.goal_rate || "moderate" });

          const hasOverride = p.plan_override_calories !== null && p.plan_override_calories !== undefined;
          const override = hasOverride
            ? {
                calories: p.plan_override_calories,
                protein: p.plan_override_protein,
                carbs: p.plan_override_carbs,
                fat: p.plan_override_fat,
              }
            : null;
          setPlanOverride(override);
          setSavedPlanOverride(override);

          // If there's an unsaved draft from earlier in this browser session
          // (e.g. the page reloaded before the user hit Save), restore it
          // over the saved DB values so in-progress edits aren't lost.
          const draft = loadDraft(userId);
          if (draft) {
            if (draft.profile) setProfile(draft.profile);
            if (draft.goal) setGoal(draft.goal);
            if (draft.planOverride !== undefined) setPlanOverride(draft.planOverride);
          }
        }

        setPersonalFoods(
          (personalFoodsRes.data || []).map((f) => ({
            id: f.id,
            name: f.name,
            calPer100g: f.cal_per_100g,
          }))
        );

        const planFoodsRows = planFoodsRes.data || [];

        setFoods(
          planFoodsRows.map((f) => ({
            id: f.id,
            name: f.name,
            grams: f.grams,
            meal: f.meal,
            course: f.course || "Main",
            calories: f.calories,
            protein: 0,
            carbs: 0,
            fat: 0,
          }))
        );

        const loadedPlanDateFrom = (planFoodsRows[0] && planFoodsRows[0].plan_date_from) || "";
        const loadedPlanDateTo = (planFoodsRows[0] && planFoodsRows[0].plan_date_to) || "";
        setPlanDateFrom(loadedPlanDateFrom);
        setPlanDateTo(loadedPlanDateTo);
        setPlanName((planFoodsRows[0] && planFoodsRows[0].plan_name) || "");

        const today = todayStr();
        const todayOutsidePlanRange =
          loadedPlanDateFrom && loadedPlanDateTo && (today < loadedPlanDateFrom || today > loadedPlanDateTo);
        setComparisonDate(todayOutsidePlanRange ? loadedPlanDateFrom : today);

        const logsByDate = {};
        (logsRes.data || []).forEach((row) => {
          const entry = {
            id: row.id,
            name: row.name,
            meal: row.meal,
            grams: row.grams,
            calories: row.calories,
            protein: row.protein,
            carbs: row.carbs,
            fat: row.fat,
          };
          if (!logsByDate[row.log_date]) logsByDate[row.log_date] = [];
          logsByDate[row.log_date].push(entry);
        });
        setLogs(logsByDate);

        setMeasurements(measurementsRes.data || []);

        const photoRows = photosRes.data || [];
        if (photoRows.length > 0) {
          const { data: signedUrls, error: signedUrlErr } = await supabase.storage
            .from("progress-photos")
            .createSignedUrls(photoRows.map((row) => row.photo_path), 3600);
          if (signedUrlErr) console.error("Couldn't create signed photo URLs:", signedUrlErr);

          const urlByPath = {};
          (signedUrls || []).forEach((s) => {
            if (s.signedUrl) urlByPath[s.path] = s.signedUrl;
          });

          setPhotos(photoRows.map((row) => ({ ...row, url: urlByPath[row.photo_path] || null })));
        } else {
          setPhotos([]);
        }

        if (userInfoRow && !userInfoRow.first_login_at) {
          const { error: firstLoginErr } = await supabase
            .from("user_info")
            .update({ first_login_at: new Date().toISOString(), verified: true })
            .eq("id", userId);
          if (firstLoginErr) console.error("Couldn't set first_login_at:", firstLoginErr);
        }
      } catch (err) {
        console.error("Load error:", err);
        setSaveError("Couldn't load your data: " + (err && err.message ? err.message : "unknown error"));
      } finally {
        setLoaded(true);
      }
    }

    load();
  }, [session?.user?.id]);

  async function persist(next) {
    if (!session || !session.user) return false;
    const userId = session.user.id;

    setSaving(true);
    setSaveError(null);

    try {
      // Profile / goal / plan override all live on the single profile row.
      if (
        next.profile !== undefined ||
        next.goal !== undefined ||
        next.planOverride !== undefined
      ) {
        const p = next.profile ?? profile;
        const g = next.goal ?? goal;
        const o = next.planOverride !== undefined ? next.planOverride : planOverride;
        const bmiResult = computeBMI(p);

        const { error } = await supabase
          .from("profile")
          .update({
            sex: p.sex,
            age: Number(p.age) || null,
            date_of_birth: p.dateOfBirth || null,
            health_notes: p.healthNotes || null,
            weight_kg: Number(p.weightKg) || null,
            height_cm: Number(p.heightCm) || null,
            activity: p.activity,
            goal_type: g.type,
            goal_rate: g.rate,
            plan_override_calories: o ? o.calories : null,
            plan_override_protein: o ? o.protein : null,
            plan_override_carbs: o ? o.carbs : null,
            plan_override_fat: o ? o.fat : null,
            bmi_current: bmiResult ? Number(bmiResult.bmi.toFixed(1)) : null,
            bmi_category_current: bmiResult ? bmiResult.category : null,
            bmi_status: bmiResult ? bmiResult.status : null,
            bmi_percent_diff: bmiResult ? Number(bmiResult.percentDiff.toFixed(1)) : null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

        if (error) throw error;
      }

      // Plan date range is shared across the whole plan, so it lives on every plan_foods row.
      if (next.planDateFrom !== undefined || next.planDateTo !== undefined) {
        const dFrom = next.planDateFrom !== undefined ? next.planDateFrom : planDateFrom;
        const dTo = next.planDateTo !== undefined ? next.planDateTo : planDateTo;

        const { error: dateErr } = await supabase
          .from("plan_foods")
          .update({
            plan_date_from: dFrom || null,
            plan_date_to: dTo || null,
          })
          .eq("user_id", userId);

        if (dateErr) throw dateErr;
      }

      // Plan name is shared across the whole plan, so it lives on every plan_foods row.
      if (next.planName !== undefined) {
        const name = next.planName;

        const { error: nameErr } = await supabase
          .from("plan_foods")
          .update({ plan_name: name || null })
          .eq("user_id", userId);

        if (nameErr) throw nameErr;
      }

      // Notification settings: single row per user_id, updated in place.
      if (next.notificationSettings !== undefined) {
        const n = next.notificationSettings;

        const { error: notifErr } = await supabase
          .from("notification_settings")
          .update({
            daily_summary_enabled: !!n.daily_summary_enabled,
            daily_summary_time: n.daily_summary_time || null,
            threshold_enabled: !!n.threshold_enabled,
            threshold_percent:
              n.threshold_percent === "" || n.threshold_percent === null || n.threshold_percent === undefined
                ? null
                : Number(n.threshold_percent),
            link_code: n.link_code || null,
          })
          .eq("user_id", userId);

        if (notifErr) throw notifErr;
      }

      // Configured meal plan ("Food materials" / "Create a plan"): full replace, scoped to this user only.
      if (next.foods !== undefined) {
        const list = next.foods;
        const { error: delErr } = await supabase.from("plan_foods").delete().eq("user_id", userId);
        if (delErr) throw delErr;

        if (list.length > 0) {
          const rows = list.map((f) => ({
            id: f.id,
            user_id: userId,
            name: f.name,
            grams: f.grams,
            meal: f.meal,
            course: f.course,
            calories: f.calories,
            plan_date_from: (f.plan_date_from !== undefined ? f.plan_date_from : planDateFrom) || null,
            plan_date_to: (f.plan_date_to !== undefined ? f.plan_date_to : planDateTo) || null,
            plan_name: (f.plan_name !== undefined ? f.plan_name : planName) || null,
          }));
          const { error: insErr } = await supabase.from("plan_foods").insert(rows);
          if (insErr) throw insErr;
        }
      }

      // Daily logs: full replace, flattening the {date: [entries]} shape into rows, scoped to this user only.
      if (next.logs !== undefined) {
        const dict = next.logs;
        const { error: delErr } = await supabase.from("meal_logs").delete().eq("user_id", userId);
        if (delErr) throw delErr;

        const rows = [];
        Object.keys(dict).forEach((date) => {
          (dict[date] || []).forEach((e) => {
            rows.push({
              id: e.id,
              user_id: userId,
              log_date: date,
              meal: e.meal,
              name: e.name,
              grams: e.grams || 0,
              calories: e.calories || 0,
              protein: e.protein || 0,
              carbs: e.carbs || 0,
              fat: e.fat || 0,
            });
          });
        });

        if (rows.length > 0) {
          const { error: insErr } = await supabase.from("meal_logs").insert(rows);
          if (insErr) throw insErr;
        }
      }

      return true;
    } catch (err) {
      console.error("Storage error:", err);
      setSaveError("Save failed: " + (err && err.message ? err.message : "unknown error"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!loaded || !session || !session.user) return;
    saveDraft(session.user.id, { profile, goal, planOverride });
  }, [profile, goal, planOverride, loaded, session]);

  const computedPlan = useMemo(() => computePlan(profile, goal), [profile, goal]);
  const bmiInfo = useMemo(() => computeBMI(profile), [profile]);
  const effectivePlan = planOverride || computedPlan;

  const dayEntries = logs[selectedDate] || [];

  const uniquePlanFoodNames = useMemo(() => {
    return Array.from(new Set(foods.map((f) => f.name)));
  }, [foods]);

  // Calories-per-100g for each plan food, derived from the plan_foods row's
  // own configured grams/calories ratio rather than looked up by name in
  // personalFoods — the personal food list can be edited or a food removed
  // from it after it was added to the plan, which would silently break a
  // name-based lookup there.
  const planFoodCalPer100gByName = useMemo(() => {
    const map = {};
    foods.forEach((f) => {
      if (!(f.name in map) && f.grams > 0) {
        map[f.name] = ((f.calories || 0) / f.grams) * 100;
      }
    });
    return map;
  }, [foods]);

  // "Plan comparison" section — steps through every day in the plan's
  // configured date range, comparing that day's logged entries against the
  // plan (which applies identically to every day, it isn't day-specific).
  const planTotalDays = useMemo(() => {
    if (!planDateFrom || !planDateTo) return 1;
    return Math.max(1, daysBetweenStr(planDateFrom, planDateTo) + 1);
  }, [planDateFrom, planDateTo]);

  const comparisonDayIndex = useMemo(() => {
    if (!planDateFrom) return 1;
    return Math.min(planTotalDays, Math.max(1, daysBetweenStr(planDateFrom, comparisonDate) + 1));
  }, [planDateFrom, comparisonDate, planTotalDays]);

  const actualEntriesForDay = useMemo(() => logs[comparisonDate] || [], [logs, comparisonDate]);

  const dailyActualTotal = useMemo(
    () => actualEntriesForDay.reduce((sum, e) => sum + (e.calories || 0), 0),
    [actualEntriesForDay]
  );

  const dailyStatus = statusFor(dailyActualTotal, effectivePlan.calories);

  // Only foods actually logged today show up here — the plan's full food
  // list is a menu of options, not a checklist everything must appear on.
  const mealComparisons = useMemo(() => {
    return MEALS.map((mealName) => {
      const mealActualEntries = actualEntriesForDay.filter((e) => e.meal === mealName);

      const seenNames = new Set();
      const loggedFoodRows = [];
      mealActualEntries.forEach((e) => {
        const key = (e.name || "").trim().toLowerCase();
        if (seenNames.has(key)) return;
        seenNames.add(key);

        const matchingActual = mealActualEntries.filter((x) => (x.name || "").trim().toLowerCase() === key);
        // Configured target is summed across the whole plan regardless of
        // which meal/course it's configured under — only the food name
        // needs to match. Display grouping still follows where it was logged.
        const matchingConfigured = foods.filter((f) => f.name.trim().toLowerCase() === key);

        loggedFoodRows.push({
          name: e.name,
          matched: matchingConfigured.length > 0,
          actualGrams: matchingActual.reduce((sum, x) => sum + (x.grams || 0), 0),
          actualCalories: matchingActual.reduce((sum, x) => sum + (x.calories || 0), 0),
          configuredGrams: matchingConfigured.reduce((sum, f) => sum + (f.grams || 0), 0),
          configuredCalories: matchingConfigured.reduce((sum, f) => sum + (f.calories || 0), 0),
        });
      });

      const mealActualTotal = mealActualEntries.reduce((sum, e) => sum + (e.calories || 0), 0);
      const mealConfiguredTotal = loggedFoodRows.reduce((sum, r) => sum + r.configuredCalories, 0);

      return { mealName, mealActualEntries, loggedFoodRows, mealActualTotal, mealConfiguredTotal };
    }).filter((m) => m.mealActualEntries.length > 0);
  }, [foods, actualEntriesForDay]);

  function goToPrevComparisonDay() {
    if (!planDateFrom) return;
    const prev = addDaysStr(comparisonDate, -1);
    if (prev >= planDateFrom) setComparisonDate(prev);
  }

  function goToNextComparisonDay() {
    if (!planDateTo) return;
    const next = addDaysStr(comparisonDate, 1);
    if (next <= planDateTo) setComparisonDate(next);
  }

  const entryCalories = entryFoodId
    ? Math.round(((planFoodCalPer100gByName[entryFoodId] || 0) * (Number(entryGrams) || 0)) / 100)
    : (Number(entryCalPer100g)
        ? Math.round((Number(entryCalPer100g) * (Number(entryGrams) || 0)) / 100)
        : 0);

  const dayTotals = useMemo(() => {
    return dayEntries.reduce(
      (acc, e) => ({
        calories: acc.calories + e.calories,
        protein: acc.protein + e.protein,
        carbs: acc.carbs + e.carbs,
        fat: acc.fat + e.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [dayEntries]);

  const planEntries = useMemo(() => {
    let fromDate;
    let toDate;

    if (planDateFrom && planDateTo) {
      fromDate = planDateFrom;
      toDate = planDateTo;
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 13);
      fromDate = cutoff.toISOString().slice(0, 10);
      toDate = todayStr();
    }

    const rows = [];

    Object.keys(logs).forEach((date) => {
      if (date >= fromDate && date <= toDate) {
        (logs[date] || []).forEach((e) => rows.push({ ...e, date }));
      }
    });

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return rows;
  }, [logs, planDateFrom, planDateTo]);

  const filteredMealEntries = useMemo(() => {
    return planEntries.filter((e) => {
      if (tableFilterType === "date") {
        const validRange = !(tableFilterDateFrom && tableFilterDateTo && tableFilterDateTo < tableFilterDateFrom);
        if (validRange) {
          if (tableFilterDateFrom && e.date < tableFilterDateFrom) return false;
          if (tableFilterDateTo && e.date > tableFilterDateTo) return false;
        }
      }
      if (tableFilterType === "meal" && tableFilterMeal && e.meal !== tableFilterMeal) return false;
      if (tableFilterType === "food" && tableFilterFood && e.name !== tableFilterFood) return false;
      return true;
    });
  }, [planEntries, tableFilterType, tableFilterDateFrom, tableFilterDateTo, tableFilterMeal, tableFilterFood]);

  const uniqueFoodNames = useMemo(() => {
    return Array.from(new Set(planEntries.map((e) => e.name))).sort();
  }, [planEntries]);

  const TABLE_PAGE_SIZE = 7;
  const totalTablePages = Math.max(1, Math.ceil(filteredMealEntries.length / TABLE_PAGE_SIZE));
  const clampedTablePage = Math.min(tablePage, totalTablePages);
  const pagedMealEntries = filteredMealEntries.slice(
    (clampedTablePage - 1) * TABLE_PAGE_SIZE,
    clampedTablePage * TABLE_PAGE_SIZE
  );

  async function saveSetup() {
    const ok = await persist({ profile, goal, planOverride });

    if (ok) {
      setSavedPlanOverride(planOverride);
      setSetupSavedFlash(true);
      setTimeout(() => setSetupSavedFlash(false), 2500);
      if (session && session.user) clearDraft(session.user.id);
    }
  }

  function numOrNull(v) {
    return v !== "" && v !== null && v !== undefined ? Number(v) : null;
  }

  async function addMeasurement() {
    if (!session || !session.user) return;
    const userId = session.user.id;

    setMeasurementSaving(true);
    setMeasurementError(null);

    try {
      const payload = {
        user_id: userId,
        date: newMeasurement.date || todayStr(),
        neck: numOrNull(newMeasurement.neck),
        waist: numOrNull(newMeasurement.waist),
        shoulder: numOrNull(newMeasurement.shoulder),
        chest: numOrNull(newMeasurement.chest),
        abdomen: numOrNull(newMeasurement.abdomen),
        thighs: numOrNull(newMeasurement.thighs),
      };

      const { data, error } = await supabase.from("body_measurements").insert(payload).select().single();
      if (error) throw error;

      setMeasurements((prev) => [data, ...prev].sort((a, b) => (a.date < b.date ? 1 : -1)));
      setNewMeasurement({ date: todayStr(), neck: "", waist: "", shoulder: "", chest: "", abdomen: "", thighs: "" });
    } catch (err) {
      setMeasurementError(err && err.message ? err.message : "Couldn't save that measurement.");
    } finally {
      setMeasurementSaving(false);
    }
  }

  async function uploadProgressPhoto() {
    if (!session || !session.user || !photoFile) return;
    const userId = session.user.id;

    setPhotoUploading(true);
    setPhotoError(null);

    try {
      const path = `${userId}/${Date.now()}-${photoFile.name}`;

      const { error: uploadErr } = await supabase.storage.from("progress-photos").upload(path, photoFile);
      if (uploadErr) throw uploadErr;

      const takenAt = newPhotoDate || todayStr();
      const { data, error: insertErr } = await supabase
        .from("progress_photos")
        .insert({ user_id: userId, taken_at: takenAt, photo_path: path })
        .select()
        .single();
      if (insertErr) throw insertErr;

      const { data: signedData, error: signedErr } = await supabase.storage
        .from("progress-photos")
        .createSignedUrl(path, 3600);
      if (signedErr) console.error("Couldn't create signed photo URL:", signedErr);

      setPhotos((prev) => [{ ...data, url: signedData?.signedUrl || null }, ...prev].sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1)));
      setPhotoFile(null);
      if (photoFileInputRef.current) photoFileInputRef.current.value = "";
    } catch (err) {
      setPhotoError(err && err.message ? err.message : "Couldn't upload that photo.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function updateNotificationSettings(patch) {
    if (!notificationSettings) return;
    const next = { ...notificationSettings, ...patch };
    const ok = await persist({ notificationSettings: next });
    if (ok) setNotificationSettings(next);
  }

  async function connectTelegram() {
    if (!notificationSettings) return;

    let code = notificationSettings.link_code;

    if (!code) {
      code = generateLinkCode();
      const next = { ...notificationSettings, link_code: code };
      const ok = await persist({ notificationSettings: next });
      if (!ok) return;
      setNotificationSettings(next);
    }

    window.open(`https://t.me/Mmadboly_bot?start=${code}`, "_blank");

    pollTelegramConnection();
  }

  // After the user is sent to Telegram to link their account, poll in the
  // background so the "Connected" status flips on its own — without this,
  // it only ever updated on the next full login. Doesn't touch `saving`,
  // since a background poll shouldn't disable the rest of the form.
  function pollTelegramConnection() {
    if (!session || !session.user) return;
    if (telegramPollRef.current) return;

    const userId = session.user.id;
    const intervalMs = 3000;
    const maxAttempts = Math.ceil(120000 / intervalMs);
    let attempts = 0;

    telegramPollRef.current = setInterval(async () => {
      attempts += 1;

      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (!error && data) {
        setNotificationSettings(data);
        if (data.target) {
          clearInterval(telegramPollRef.current);
          telegramPollRef.current = null;
          return;
        }
      }

      if (attempts >= maxAttempts) {
        clearInterval(telegramPollRef.current);
        telegramPollRef.current = null;
      }
    }, intervalMs);
  }

  async function checkTelegramConnection() {
    if (!session || !session.user) return;

    setSaving(true);
    setSaveError(null);

    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;
      setNotificationSettings(data);
    } catch (err) {
      console.error("Check connection error:", err);
      setSaveError("Couldn't check connection: " + (err && err.message ? err.message : "unknown error"));
    } finally {
      setSaving(false);
    }
  }

  // Best-effort background check, fired after a meal is logged — never
  // surfaces errors or blocks the UI, since a missed notification isn't
  // worth interrupting the logging flow over.
  async function checkCalorieThreshold(logsAfter, userId, targetCalories, entryDate) {
    try {
      const { data: notifRow, error } = await supabase
        .from("notification_settings")
        .select("threshold_enabled, threshold_percent, threshold_last_sent_date, target")
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !notifRow) return;
      if (!notifRow.threshold_enabled || !notifRow.target) return;

      const today = todayStr();
      if (notifRow.threshold_last_sent_date === today) return;
      if (!targetCalories) return;

      const todayTotal = (logsAfter[entryDate] || []).reduce((sum, e) => sum + (e.calories || 0), 0);
      const pct = (todayTotal / targetCalories) * 100;
      const thresholdPct = Number(notifRow.threshold_percent) || 0;

      console.log("[checkCalorieThreshold] entryDate:", entryDate, "todayTotal:", todayTotal, "targetCalories:", targetCalories, "pct:", pct, "thresholdPct:", thresholdPct);

      if (pct >= thresholdPct) {
        console.log("[checkCalorieThreshold] threshold reached, sending notification");
        await supabase.functions.invoke("send-notification", {
          body: {
            user_id: userId,
            message: `⚠️ Attention please! You've reached ${Math.round(thresholdPct)}% of your daily calorie target.`,
            type: "threshold",
          },
        });

        await supabase
          .from("notification_settings")
          .update({ threshold_last_sent_date: today })
          .eq("user_id", userId);
      } else {
        console.log("[checkCalorieThreshold] threshold not reached, skipping notification");
      }
    } catch (err) {
      console.error("Threshold notification check failed (non-critical):", err);
    }
  }

  async function addFood() {
    setAddFoodError(null);

    if (!newFood.personalFoodId) {
      setAddFoodError("Select a food from your list first.");
      return;
    }

    const match = personalFoods.find((f) => f.id === newFood.personalFoodId);

    if (!match) {
      setAddFoodError("That food isn't in your list yet. Add it first in \"Configure your food list\".");
      return;
    }

    const grams = Number(newFood.grams);

    if (!grams || grams <= 0) {
      setAddFoodError("Enter a gram amount.");
      return;
    }

    const alreadyInMeal = foods.some((f) => f.name === match.name && f.meal === newFood.meal && f.course === newFood.course);

    if (alreadyInMeal) {
      setAddFoodError(`"${match.name}" is already added under ${newFood.meal} / ${newFood.course}. Pick a different meal or course to add it again.`);
      return;
    }

    const food = {
      id: crypto.randomUUID(),
      name: match.name,
      grams,
      meal: newFood.meal,
      course: newFood.course,
      calories: match.calPer100g ? Math.round((match.calPer100g * grams) / 100) : 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      plan_date_from: planDateFrom,
      plan_date_to: planDateTo,
      plan_name: planName,
    };

    const { error: insErr } = await supabase.from("plan_foods").insert({
      id: food.id,
      user_id: session.user.id,
      name: food.name,
      grams: food.grams,
      meal: food.meal,
      course: food.course,
      calories: food.calories,
      plan_name: food.plan_name || null,
      plan_date_from: food.plan_date_from || null,
      plan_date_to: food.plan_date_to || null,
    });

    if (!insErr) {
      setFoods([...foods, food]);
      setNewFood({ personalFoodId: "", grams: "", calories: "", meal: newFood.meal, course: newFood.course });
    } else {
      setAddFoodError("Couldn't save this food. Please try again.");
    }
  }

  async function removeFood(id) {
    const { error: delErr } = await supabase.from("plan_foods").delete().eq("id", id).eq("user_id", session.user.id);

    if (!delErr) {
      setFoods(foods.filter((f) => f.id !== id));
    } else {
      setAddFoodError("Couldn't remove this food. Please try again.");
    }
  }

  async function submitFeedback(kind) {
    const isIdea = kind === "idea";
    const text = (isIdea ? ideaText : bugText).trim();
    const setError = isIdea ? setIdeaError : setBugError;
    const setText = isIdea ? setIdeaText : setBugText;
    const setFlash = isIdea ? setIdeaFlash : setBugFlash;

    setError(null);

    if (!text) {
      setError(isIdea ? "Type your idea first." : "Describe the bug first.");
      return;
    }

    const { error } = await supabase.from("feedback").insert({
      id: crypto.randomUUID(),
      user_id: session.user.id,
      type: kind,
      message: text,
    });

    if (!error) {
      setText("");
      setFlash(true);
      setTimeout(() => setFlash(false), 2500);
    } else {
      setError("Couldn't submit. Please try again.");
    }
  }

  async function loadClients() {
    if (!session) return;

    setClientsLoading(true);
    setClientsError(null);

    try {
      const { data: links, error: linksErr } = await supabase
        .from("coach_clients")
        .select("client_id")
        .eq("coach_id", session.user.id)
        .eq("status", "active");
      if (linksErr) throw linksErr;

      const clientIds = (links || []).map((l) => l.client_id);

      if (clientIds.length === 0) {
        setClients([]);
        return;
      }

      const [infosRes, profilesRes] = await Promise.all([
        supabase.from("user_info").select("id, name, first_login_at").in("id", clientIds),
        supabase.from("client_profile").select("user_id, date_from, date_to").in("user_id", clientIds),
      ]);
      if (infosRes.error) throw infosRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const infoById = {};
      (infosRes.data || []).forEach((row) => {
        infoById[row.id] = row;
      });

      const profileByClientId = {};
      (profilesRes.data || []).forEach((row) => {
        profileByClientId[row.user_id] = row;
      });

      setClients(
        clientIds.map((id) => {
          const info = infoById[id] || {};
          const clientProfile = profileByClientId[id] || {};
          return {
            id,
            name: info.name || "(name unavailable)",
            active: !!info.first_login_at,
            dateFrom: clientProfile.date_from || null,
            dateTo: clientProfile.date_to || null,
          };
        })
      );
    } catch (err) {
      setClientsError(err && err.message ? err.message : "Couldn't load your clients.");
    } finally {
      setClientsLoading(false);
    }
  }

  async function loadPlanTypes() {
    if (!session) return;

    setPlanTypesLoading(true);
    setPlanTypesError(null);

    try {
      const { data, error } = await supabase
        .from("coach_plan_types")
        .select("*")
        .eq("coach_id", session.user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setPlanTypes(data || []);
    } catch (err) {
      setPlanTypesError(err && err.message ? err.message : "Couldn't load your plan types.");
    } finally {
      setPlanTypesLoading(false);
    }
  }

  useEffect(() => {
    if (roleId === 2) {
      setView("home");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

  useEffect(() => {
    if (roleId === 2 && (view === "home" || (view === "clients" && clientsView === "grid") || view === "plans" || view === "chat")) {
      loadClients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, clientsView, session]);

  useEffect(() => {
    if (roleId === 2 && (view === "clients" || view === "administration" || view === "client-detail")) {
      loadPlanTypes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, session]);

  useEffect(() => {
    if (roleId === 2 && view === "administration" && adminTab === "foodList") {
      loadGlobalFoods();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, adminTab, session]);

  useEffect(() => {
    if (roleId === 2 && view === "plans" && planBuilderClientId) {
      loadClientPlan(planBuilderClientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, planBuilderClientId, session]);

  useEffect(() => {
    if (roleId === 2 && view === "plans" && plansView === "details" && planDetailsClientId) {
      loadPlanDetails(planDetailsClientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, plansView, planDetailsClientId, session]);

  useEffect(() => {
    if (view === "plans") {
      setPlansView("list");
      setPlanBuilderClientId(null);
      setPlanDetailsClientId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (roleId === 2 && view === "plans" && plansView === "list") {
      loadClientPlanSummaries(clients.filter((c) => c.active).map((c) => c.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, plansView, clients, session]);

  useEffect(() => {
    if (roleId === 2 && view === "client-detail" && selectedClientId) {
      loadClientDetail(selectedClientId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, selectedClientId, session]);

  useEffect(() => {
    if (roleId === 3) {
      loadMyCoach();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, session]);

  useEffect(() => {
    if (view !== "chat") {
      setChatSelectedClientId(null);
      setChatMessages([]);
      setChatError(null);
      setChatInput("");
      setChatSendError(null);
    }
  }, [view]);

  useEffect(() => {
    if (!session) {
      setChatUnreadByClient({});
      return;
    }

    loadUnreadCounts();

    const channel = supabase
      .channel(`chat-unread-${session.user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `recipient_id=eq.${session.user.id}` },
        () => {
          loadUnreadCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (view !== "chat" || !session) return;

    const myId = session.user.id;
    const otherId = roleId === 2 ? chatSelectedClientId : myCoachId;
    if (!otherId) {
      setChatMessages([]);
      return;
    }

    loadChatThread(otherId);

    const channel = supabase
      .channel(`chat-thread-${myId}-${otherId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${otherId}` },
        (payload) => {
          const row = payload.new;
          if (row.recipient_id !== myId) return;
          setChatMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          markConversationRead(otherId);
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `sender_id=eq.${myId}` },
        (payload) => {
          const row = payload.new;
          if (row.recipient_id !== otherId) return;
          setChatMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, roleId, chatSelectedClientId, myCoachId, session]);

  async function loadMyCoach() {
    if (!session) return;

    setMyCoachLoading(true);

    try {
      const { data, error } = await supabase
        .from("coach_clients")
        .select("coach_id")
        .eq("client_id", session.user.id)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;

      const coachId = (data && data.coach_id) || null;
      setMyCoachId(coachId);

      if (coachId) {
        const { data: coachInfo } = await supabase.from("user_info").select("name").eq("id", coachId).maybeSingle();
        setMyCoachName((coachInfo && coachInfo.name) || "Your coach");
      } else {
        setMyCoachName(null);
      }
    } catch (err) {
      setMyCoachId(null);
      setMyCoachName(null);
    } finally {
      setMyCoachLoading(false);
    }
  }

  async function loadUnreadCounts() {
    if (!session) return;

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("recipient_id", session.user.id)
        .is("read_at", null);
      if (error) throw error;

      const byClient = {};
      (data || []).forEach((row) => {
        byClient[row.sender_id] = (byClient[row.sender_id] || 0) + 1;
      });
      setChatUnreadByClient(byClient);
    } catch (err) {
      // Unread badge is a convenience indicator; a failure here shouldn't block chat.
    }
  }

  async function loadChatThread(otherId) {
    if (!session || !otherId) return;

    setChatLoading(true);
    setChatError(null);

    try {
      const myId = session.user.id;
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(`and(sender_id.eq.${myId},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${myId})`)
        .order("created_at", { ascending: true });
      if (error) throw error;

      setChatMessages(data || []);
      await markConversationRead(otherId);
    } catch (err) {
      setChatError(err && err.message ? err.message : "Couldn't load messages.");
    } finally {
      setChatLoading(false);
    }
  }

  async function markConversationRead(otherId) {
    if (!session || !otherId) return;

    try {
      const { error } = await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", session.user.id)
        .eq("sender_id", otherId)
        .is("read_at", null);
      if (error) throw error;

      setChatUnreadByClient((prev) => {
        if (!prev[otherId]) return prev;
        const next = { ...prev };
        delete next[otherId];
        return next;
      });
    } catch (err) {
      // Best-effort; the unread badge will resync on the next load.
    }
  }

  // Best-effort background push, fired after a chat message is sent — never
  // surfaces errors or blocks the chat UI, same as checkCalorieThreshold.
  // Intentionally leaves the message body out of the notification text
  // (only the sender's name), since it goes through an external channel.
  async function notifyNewChatMessage(recipientId, senderId) {
    try {
      const { data: senderInfo } = await supabase
        .from("user_info")
        .select("name")
        .eq("id", senderId)
        .maybeSingle();

      const senderName = (senderInfo && senderInfo.name) || "Someone";

      await supabase.functions.invoke("send-notification", {
        body: {
          user_id: recipientId,
          message: `💬 You have a new message from ${senderName}.`,
          type: "chat_message",
        },
      });
    } catch (err) {
      console.error("Chat notification failed (non-critical):", err);
    }
  }

  async function sendChatMessage(otherId) {
    const body = chatInput.trim();
    if (!body || !otherId || !session) return;

    setChatSending(true);
    setChatSendError(null);

    try {
      const { data, error } = await supabase
        .from("messages")
        .insert({ sender_id: session.user.id, recipient_id: otherId, body })
        .select()
        .single();
      if (error) throw error;

      setChatMessages((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]));
      setChatInput("");
      notifyNewChatMessage(otherId, session.user.id);
    } catch (err) {
      setChatSendError(err && err.message ? err.message : "Couldn't send that message.");
    } finally {
      setChatSending(false);
    }
  }

  async function loadClientDetail(clientId) {
    if (!session || !clientId) return;

    setClientDetailLoading(true);
    setClientDetailError(null);

    try {
      const [infoRes, profileRes, linkRes] = await Promise.all([
        supabase.from("user_info").select("id, name, email, phone, first_login_at").eq("id", clientId).maybeSingle(),
        supabase.from("client_profile").select("user_id, date_from, date_to, plan_type_id").eq("user_id", clientId).maybeSingle(),
        supabase.from("coach_clients").select("status").eq("coach_id", session.user.id).eq("client_id", clientId).maybeSingle(),
      ]);
      if (infoRes.error) throw infoRes.error;
      if (profileRes.error) throw profileRes.error;
      if (linkRes.error) throw linkRes.error;

      const info = infoRes.data || {};
      const clientProfile = profileRes.data || {};
      const link = linkRes.data || {};

      let planTypeName = null;
      if (clientProfile.plan_type_id) {
        const cached = planTypes.find((pt) => pt.id === clientProfile.plan_type_id);
        if (cached) {
          planTypeName = cached.name;
        } else {
          const { data: ptRow, error: ptErr } = await supabase
            .from("coach_plan_types")
            .select("name")
            .eq("id", clientProfile.plan_type_id)
            .maybeSingle();
          if (ptErr) throw ptErr;
          planTypeName = ptRow ? ptRow.name : null;
        }
      }

      setClientDetail({
        id: clientId,
        name: info.name || "(name unavailable)",
        email: info.email || null,
        phone: info.phone || null,
        dateFrom: clientProfile.date_from || null,
        dateTo: clientProfile.date_to || null,
        planTypeId: clientProfile.plan_type_id || null,
        planTypeName,
        firstLoginAt: info.first_login_at || null,
        coachStatus: link.status || "active",
      });
    } catch (err) {
      setClientDetailError(err && err.message ? err.message : "Couldn't load this client.");
    } finally {
      setClientDetailLoading(false);
    }
  }

  function startAddClient() {
    setAddClientName("");
    setAddClientEmail("");
    setAddClientPhoneCountryCode("+20");
    setAddClientPhoneNumber("");
    setAddClientPlanTypeId("");
    setAddClientDateFrom("");
    setAddClientDateTo("");
    setAddClientMessage(null);
    setCreatedClientCredentials(null);
    setEditingClientId(null);
    setClientsView("add");
  }

  function startEditClient(client) {
    const { code, number } = splitPhoneByDialCode(client.phone);
    setAddClientName(client.name || "");
    setAddClientEmail(client.email || "");
    setAddClientPhoneCountryCode(code);
    setAddClientPhoneNumber(number);
    setAddClientPlanTypeId(client.planTypeId || "");
    setAddClientDateFrom(client.dateFrom || "");
    setAddClientDateTo(client.dateTo || "");
    setAddClientMessage(null);
    setCreatedClientCredentials(null);
    setEditingClientId(client.id);
    setClientsView("add");
    setView("clients");
  }

  async function submitEditClient() {
    setAddClientMessage(null);
    const clientId = editingClientId;
    const name = addClientName.trim();
    const email = addClientEmail.trim();

    if (!name) {
      setAddClientMessage({ type: "error", text: "Enter the client's name." });
      return;
    }
    if (!email) {
      setAddClientMessage({ type: "error", text: describeAddClientError("email_required") });
      return;
    }

    setAddClientBusy(true);

    const phoneNumber = addClientPhoneNumber.trim();
    const combinedPhone = phoneNumber ? `${addClientPhoneCountryCode}${phoneNumber}` : null;

    try {
      const { data, error } = await supabase.functions.invoke("edit-client", {
        body: {
          client_id: clientId,
          email,
          name,
          phone: combinedPhone,
          plan_type_id: addClientPlanTypeId || null,
          date_from: addClientDateFrom || null,
          date_to: addClientDateTo || null,
        },
      });
      if (error) throw error;

      if (data && data.ok) {
        setEditingClientId(null);
        setClientsView("grid");
        setView("client-detail");
        setSelectedClientId(clientId);
        setClientDetailFlash("Client details updated.");
        setTimeout(() => setClientDetailFlash(null), 2500);
        loadClientDetail(clientId);
        loadClients();
      } else {
        setAddClientMessage({ type: "error", text: describeAddClientError(data && data.reason) });
      }
    } catch (err) {
      setAddClientMessage({ type: "error", text: "Couldn't update the client. Please try again." });
    } finally {
      setAddClientBusy(false);
    }
  }

  async function removeClient(clientId, name) {
    const confirmed = window.confirm(`Are you sure? This permanently deletes ${name} and all their data.`);
    if (!confirmed) return;

    setClientDetailBusy(true);
    setClientDetailError(null);

    try {
      const { error } = await supabase.from("user_info").delete().eq("id", clientId);
      if (error) throw error;

      setSelectedClientId(null);
      setClientDetail(null);
      setView("clients");
      setClientsView("grid");
      loadClients();
    } catch (err) {
      setClientDetailError(err && err.message ? err.message : "Couldn't remove this client. Please try again.");
    } finally {
      setClientDetailBusy(false);
    }
  }

  async function toggleClientStatus(client) {
    const nextStatus = client.coachStatus === "inactive" ? "active" : "inactive";

    setClientDetailBusy(true);
    setClientDetailError(null);

    try {
      const { error } = await supabase
        .from("coach_clients")
        .update({ status: nextStatus })
        .eq("coach_id", session.user.id)
        .eq("client_id", client.id);
      if (error) throw error;

      loadClientDetail(client.id);
    } catch (err) {
      setClientDetailError(err && err.message ? err.message : "Couldn't update this client's status. Please try again.");
    } finally {
      setClientDetailBusy(false);
    }
  }

  async function submitAddClient() {
    setAddClientMessage(null);
    const name = addClientName.trim();
    const email = addClientEmail.trim();

    if (!name) {
      setAddClientMessage({ type: "error", text: "Enter the client's name." });
      return;
    }
    if (!email) {
      setAddClientMessage({ type: "error", text: describeAddClientError("email_required") });
      return;
    }

    setAddClientBusy(true);

    const phoneNumber = addClientPhoneNumber.trim();
    const combinedPhone = phoneNumber ? `${addClientPhoneCountryCode}${phoneNumber}` : null;

    try {
      const { data, error } = await supabase.functions.invoke("create-client", {
        body: {
          email,
          name,
          phone: combinedPhone,
          plan_type_id: addClientPlanTypeId || null,
          date_from: addClientDateFrom || null,
          date_to: addClientDateTo || null,
        },
      });
      if (error) throw error;

      if (data && data.ok) {
        setCreatedClientCredentials({
          email: data.email || email,
          tempPassword: data.temp_password,
        });
        setAddClientName("");
        setAddClientEmail("");
        setAddClientPhoneCountryCode("+20");
        setAddClientPhoneNumber("");
        setAddClientPlanTypeId("");
        setAddClientDateFrom("");
        setAddClientDateTo("");
        setClientsView("grid");
        loadClients();
      } else {
        setAddClientMessage({ type: "error", text: describeAddClientError(data && data.reason) });
      }
    } catch (err) {
      setAddClientMessage({ type: "error", text: "Couldn't send the invite. Please try again." });
    } finally {
      setAddClientBusy(false);
    }
  }

  async function submitAddPlanType() {
    setAddPlanTypeError(null);
    const name = newPlanTypeName.trim();

    if (!name) {
      setAddPlanTypeError("Enter a plan type name.");
      return;
    }

    setAddPlanTypeBusy(true);

    try {
      const { error } = await supabase.from("coach_plan_types").insert({ coach_id: session.user.id, name });
      if (error) throw error;
      setNewPlanTypeName("");
      loadPlanTypes();
    } catch (err) {
      setAddPlanTypeError(err && err.message ? err.message : "Couldn't add plan type. Please try again.");
    } finally {
      setAddPlanTypeBusy(false);
    }
  }

  async function deletePlanType(id) {
    setPlanTypesError(null);
    try {
      const { error } = await supabase.from("coach_plan_types").delete().eq("id", id).eq("coach_id", session.user.id);
      if (error) throw error;
      loadPlanTypes();
    } catch (err) {
      setPlanTypesError(err && err.message ? err.message : "Couldn't delete plan type.");
    }
  }

  async function loadGlobalFoods() {
    setGlobalFoodsLoading(true);
    setGlobalFoodsError(null);

    try {
      const { data, error } = await supabase.from("global_food_list").select("*").order("name", { ascending: true });
      if (error) throw error;

      setGlobalFoods(
        (data || []).map((f) => ({
          id: f.id,
          name: f.name,
          calPer100g: f.cal_per_100g,
        }))
      );
    } catch (err) {
      setGlobalFoodsError(err && err.message ? err.message : "Couldn't load the global food list.");
    } finally {
      setGlobalFoodsLoading(false);
    }
  }

  async function loadClientPlan(clientId) {
    setClientPlanLoading(true);
    setClientPlanError(null);
    setClientPlanAddError(null);
    setClientPlanSaveError(null);
    setClientPlanSendError(null);
    setNewClientPlanFood({ foodKey: "", grams: "", calories: "", meal: "Breakfast", course: "Main" });

    try {
      const [planFoodsRes, profileRes] = await Promise.all([
        supabase.from("plan_foods").select("*").eq("user_id", clientId).order("created_at", { ascending: true }),
        supabase.from("client_profile").select("date_from, date_to, plan_status").eq("user_id", clientId).maybeSingle(),
      ]);
      if (planFoodsRes.error) throw planFoodsRes.error;
      if (profileRes.error) throw profileRes.error;

      const rows = planFoodsRes.data || [];
      const clientProfile = profileRes.data || {};

      setClientPlanFoods(
        rows.map((f) => ({
          id: f.id,
          name: f.name,
          grams: f.grams,
          meal: f.meal,
          course: f.course || "Main",
          calories: f.calories,
        }))
      );
      setClientPlanName((rows[0] && rows[0].plan_name) || "");
      setClientPlanStatus(clientProfile.plan_status || null);

      if (rows.length > 0) {
        setClientPlanDateFrom(rows[0].plan_date_from || "");
        setClientPlanDateTo(rows[0].plan_date_to || "");
      } else {
        setClientPlanDateFrom(clientProfile.date_from || "");
        setClientPlanDateTo(clientProfile.date_to || "");
      }
    } catch (err) {
      setClientPlanError(err && err.message ? err.message : "Couldn't load this client's plan.");
    } finally {
      setClientPlanLoading(false);
    }
  }

  async function loadClientPlanSummaries(clientIds) {
    if (!clientIds || clientIds.length === 0) {
      setClientPlanSummaries({});
      setClientPlanStatuses({});
      return;
    }

    setClientPlanSummariesLoading(true);

    try {
      const [foodsRes, profilesRes] = await Promise.all([
        supabase.from("plan_foods").select("user_id, meal").in("user_id", clientIds),
        supabase.from("client_profile").select("user_id, plan_status").in("user_id", clientIds),
      ]);
      if (foodsRes.error) throw foodsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      const mealsByClient = {};
      (foodsRes.data || []).forEach((row) => {
        if (!mealsByClient[row.user_id]) mealsByClient[row.user_id] = new Set();
        mealsByClient[row.user_id].add(row.meal);
      });

      const summaries = {};
      Object.keys(mealsByClient).forEach((id) => {
        summaries[id] = mealsByClient[id].size;
      });

      const statuses = {};
      (profilesRes.data || []).forEach((row) => {
        statuses[row.user_id] = row.plan_status || null;
      });

      setClientPlanSummaries(summaries);
      setClientPlanStatuses(statuses);
    } catch (err) {
      // Plan status is a convenience indicator on the client list; a failure here
      // shouldn't block the coach from opening a client's plan.
    } finally {
      setClientPlanSummariesLoading(false);
    }
  }

  function editClientPlan(clientId) {
    setPlanBuilderClientId(clientId);
    setPlansView("builder");
  }

  function backToClientsList() {
    setPlansView("list");
    setPlanBuilderClientId(null);
    setPlanDetailsClientId(null);
  }

  function addClientPlanFood() {
    setClientPlanAddError(null);

    if (!newClientPlanFood.foodKey) {
      setClientPlanAddError("Select a food from the list first.");
      return;
    }

    const match = personalFoods.find((f) => f.id === newClientPlanFood.foodKey);

    if (!match) {
      setClientPlanAddError("That food is no longer available. Please pick another.");
      return;
    }

    const grams = Number(newClientPlanFood.grams);

    if (!grams || grams <= 0) {
      setClientPlanAddError("Enter a gram amount.");
      return;
    }

    const alreadyInMeal = clientPlanFoods.some(
      (f) => f.name === match.name && f.meal === newClientPlanFood.meal && f.course === newClientPlanFood.course
    );

    if (alreadyInMeal) {
      setClientPlanAddError(`"${match.name}" is already added under ${newClientPlanFood.meal} / ${newClientPlanFood.course}. Pick a different meal or course to add it again.`);
      return;
    }

    const food = {
      id: crypto.randomUUID(),
      name: match.name,
      grams,
      meal: newClientPlanFood.meal,
      course: newClientPlanFood.course,
      calories: match.calPer100g ? Math.round((match.calPer100g * grams) / 100) : 0,
    };

    setClientPlanFoods([...clientPlanFoods, food]);
    setNewClientPlanFood({ foodKey: "", grams: "", calories: "", meal: newClientPlanFood.meal, course: newClientPlanFood.course });
  }

  function removeClientPlanFood(id) {
    setClientPlanFoods(clientPlanFoods.filter((f) => f.id !== id));
  }

  async function saveClientPlan() {
    if (!planBuilderClientId) return;

    setClientPlanSaveError(null);
    setClientPlanSaveBusy(true);

    try {
      const { error: delErr } = await supabase.from("plan_foods").delete().eq("user_id", planBuilderClientId);
      if (delErr) throw delErr;

      if (clientPlanFoods.length > 0) {
        const rows = clientPlanFoods.map((f) => ({
          id: f.id,
          user_id: planBuilderClientId,
          name: f.name,
          grams: f.grams,
          meal: f.meal,
          course: f.course,
          calories: f.calories,
          plan_name: clientPlanName || null,
          plan_date_from: clientPlanDateFrom || null,
          plan_date_to: clientPlanDateTo || null,
        }));
        const { error: insErr } = await supabase.from("plan_foods").insert(rows);
        if (insErr) throw insErr;
      }

      const { error: profileErr } = await supabase
        .from("client_profile")
        .update({
          date_from: clientPlanDateFrom || null,
          date_to: clientPlanDateTo || null,
          plan_status: "draft",
        })
        .eq("user_id", planBuilderClientId);
      if (profileErr) throw profileErr;

      setClientPlanStatus("draft");
      setClientPlanSummaries((prev) => ({
        ...prev,
        [planBuilderClientId]: new Set(clientPlanFoods.map((f) => f.meal)).size,
      }));
    } catch (err) {
      setClientPlanSaveError(err && err.message ? err.message : "Couldn't save this plan. Please try again.");
    } finally {
      setClientPlanSaveBusy(false);
    }
  }

  async function sendClientPlan() {
    if (!planBuilderClientId || clientPlanStatus !== "draft") return;

    setClientPlanSendError(null);
    setClientPlanSendBusy(true);

    try {
      const { error } = await supabase
        .from("client_profile")
        .update({ plan_status: "active" })
        .eq("user_id", planBuilderClientId);
      if (error) throw error;

      setClientPlanStatus("active");
    } catch (err) {
      setClientPlanSendError(err && err.message ? err.message : "Couldn't send this plan. Please try again.");
    } finally {
      setClientPlanSendBusy(false);
    }
  }

  async function loadPlanDetails(clientId) {
    setPlanDetailsLoading(true);
    setPlanDetailsError(null);

    try {
      const [planFoodsRes, profileRes] = await Promise.all([
        supabase.from("plan_foods").select("*").eq("user_id", clientId).order("created_at", { ascending: true }),
        supabase.from("client_profile").select("plan_status").eq("user_id", clientId).maybeSingle(),
      ]);
      if (planFoodsRes.error) throw planFoodsRes.error;
      if (profileRes.error) throw profileRes.error;

      const rows = planFoodsRes.data || [];

      setPlanDetailsFoods(
        rows.map((f) => ({
          id: f.id,
          name: f.name,
          grams: f.grams,
          meal: f.meal,
          course: f.course || "Main",
          calories: f.calories,
        }))
      );
      setPlanDetailsStatus((profileRes.data && profileRes.data.plan_status) || null);
    } catch (err) {
      setPlanDetailsError(err && err.message ? err.message : "Couldn't load this client's plan.");
    } finally {
      setPlanDetailsLoading(false);
    }
  }

  function openClientPlanDetails(clientId) {
    setPlanDetailsClientId(clientId);
    setPlansView("details");
  }

  async function deactivateClientPlan(clientId) {
    setPlanDetailsError(null);
    setPlanDetailsDeactivateBusy(true);

    try {
      const { error } = await supabase
        .from("client_profile")
        .update({ plan_status: "inactive" })
        .eq("user_id", clientId);
      if (error) throw error;

      setPlanDetailsStatus("inactive");
    } catch (err) {
      setPlanDetailsError(err && err.message ? err.message : "Couldn't deactivate this plan. Please try again.");
    } finally {
      setPlanDetailsDeactivateBusy(false);
    }
  }

  async function removeClientPlanEntirely(clientId, name) {
    const confirmed = window.confirm(
      `Remove ${name || "this client"}'s plan? This permanently deletes all of their plan foods and can't be undone.`
    );
    if (!confirmed) return;

    setPlanDetailsError(null);
    setPlanDetailsRemoveBusy(true);

    try {
      const { error } = await supabase.from("plan_foods").delete().eq("user_id", clientId);
      if (error) throw error;

      setClientPlanSummaries((prev) => ({ ...prev, [clientId]: 0 }));
      setPlansView("list");
      setPlanDetailsClientId(null);
    } catch (err) {
      setPlanDetailsError(err && err.message ? err.message : "Couldn't remove this plan. Please try again.");
    } finally {
      setPlanDetailsRemoveBusy(false);
    }
  }

  async function addPersonalFood() {
    setPersonalFoodError(null);

    if (!newPersonalFood.name) {
      setPersonalFoodError("Fill in the food name.");
      return;
    }

    const hasCalories = newPersonalFood.calPer100g !== "" && newPersonalFood.calPer100g !== null && newPersonalFood.calPer100g !== undefined;
    const calPer100g = hasCalories ? Number(newPersonalFood.calPer100g) : null;

    if (hasCalories && (!calPer100g || calPer100g <= 0)) {
      setPersonalFoodError("Calories per 100g must be a positive number, or left blank.");
      return;
    }

    const duplicate = personalFoods.some((f) => f.name.toLowerCase() === newPersonalFood.name.trim().toLowerCase());

    if (duplicate) {
      setPersonalFoodError("A food with that name is already in your list.");
      return;
    }

    const entry = {
      id: crypto.randomUUID(),
      name: newPersonalFood.name.trim(),
      calPer100g,
    };

    const { error: insErr } = await supabase.from("food_list").insert({
      id: entry.id,
      user_id: session.user.id,
      name: entry.name,
      cal_per_100g: entry.calPer100g,
    });

    if (!insErr) {
      setPersonalFoods([...personalFoods, entry]);
      setNewPersonalFood({ name: "", calPer100g: "" });
    } else {
      setPersonalFoodError("Couldn't save this food. Please try again.");
    }
  }

  async function removePersonalFood(id) {
    const { error: delErr } = await supabase.from("food_list").delete().eq("id", id).eq("user_id", session.user.id);

    if (!delErr) {
      setPersonalFoods(personalFoods.filter((f) => f.id !== id));
    } else {
      setPersonalFoodError("Couldn't remove this food. Please try again.");
    }
  }

  function toggleGlobalFoodSelection(id) {
    setSelectedGlobalFoodIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  async function transferSelectedGlobalFoods() {
    setTransferError(null);

    const selected = globalFoods.filter((f) => selectedGlobalFoodIds.includes(f.id));
    if (selected.length === 0) return;

    setTransferBusy(true);

    try {
      const ownNames = new Set(personalFoods.map((f) => f.name.trim().toLowerCase()));
      const toInsert = selected.filter((f) => !ownNames.has(f.name.trim().toLowerCase()));

      if (toInsert.length > 0) {
        const { error } = await supabase.from("food_list").insert(
          toInsert.map((f) => ({
            id: crypto.randomUUID(),
            user_id: session.user.id,
            name: f.name,
            cal_per_100g: f.calPer100g,
          }))
        );
        if (error) throw error;
      }

      setSelectedGlobalFoodIds([]);

      const { data, error: reloadErr } = await supabase
        .from("food_list")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true });
      if (reloadErr) throw reloadErr;

      setPersonalFoods((data || []).map((f) => ({ id: f.id, name: f.name, calPer100g: f.cal_per_100g })));
    } catch (err) {
      setTransferError(err && err.message ? err.message : "Couldn't transfer the selected foods. Please try again.");
    } finally {
      setTransferBusy(false);
    }
  }

  function startEditFood(food) {
    setEditingFoodId(food.id);
    setEditFoodName(food.name);
    setEditFoodCalPer100g(food.calPer100g ? String(food.calPer100g) : "");
    setEditFoodError(null);
  }

  function cancelEditFood() {
    setEditingFoodId(null);
    setEditFoodError(null);
  }

  async function saveEditFood() {
    setEditFoodError(null);

    const name = editFoodName.trim();
    if (!name) {
      setEditFoodError("Fill in the food name.");
      return;
    }

    const hasCalories = editFoodCalPer100g !== "" && editFoodCalPer100g !== null && editFoodCalPer100g !== undefined;
    const calPer100g = hasCalories ? Number(editFoodCalPer100g) : null;

    if (hasCalories && (!calPer100g || calPer100g <= 0)) {
      setEditFoodError("Calories per 100g must be a positive number, or left blank.");
      return;
    }

    setEditFoodBusy(true);

    try {
      const { error } = await supabase
        .from("food_list")
        .update({ name, cal_per_100g: calPer100g })
        .eq("id", editingFoodId)
        .eq("user_id", session.user.id);
      if (error) throw error;

      setPersonalFoods(personalFoods.map((f) => (f.id === editingFoodId ? { ...f, name, calPer100g } : f)));
      setEditingFoodId(null);
    } catch (err) {
      setEditFoodError(err && err.message ? err.message : "Couldn't save changes. Please try again.");
    } finally {
      setEditFoodBusy(false);
    }
  }

  async function addEntry() {
    setEntryError(null);

    if (entryFoodId && customName) {
      setEntryError("You have to enter only one meal — either pick from the list or type a name, not both.");
      return;
    }

    if (!entryFoodId && !customName) {
      setEntryError("Select a food from the list, or type a food name.");
      return;
    }

    const grams = Number(entryGrams);

    if (!grams || grams <= 0) {
      setEntryError("Enter a gram amount.");
      return;
    }

    let entry;

    if (entryFoodId) {
      const calPer100g = planFoodCalPer100gByName[entryFoodId] || 0;

      entry = {
        id: crypto.randomUUID(),
        name: entryFoodId,
        meal: logMeal,
        grams,
        calories: Math.round((calPer100g * grams) / 100),
        protein: 0,
        carbs: 0,
        fat: 0,
      };
    } else {
      const calPer100g = Number(entryCalPer100g);

      if (!entryCalPer100g || !calPer100g || calPer100g <= 0) {
        setEntryError("Enter calories per 100 gram for this food.");
        return;
      }

      entry = {
        id: crypto.randomUUID(),
        name: customName,
        meal: logMeal,
        grams,
        calories: Math.round((calPer100g * grams) / 100),
        protein: 0,
        carbs: 0,
        fat: 0,
      };
    }

    const nextLogs = { ...logs, [selectedDate]: [...dayEntries, entry] };
    const ok = await persist({ logs: nextLogs });

    if (ok) {
      setLogs(nextLogs);
      setEntryFoodId("");
      setCustomName("");
      setEntryGrams("");
      setEntryCalPer100g("");

      checkCalorieThreshold(nextLogs, session.user.id, effectivePlan.calories, selectedDate);
    } else {
      setEntryError("Couldn't save this entry. Please try again.");
    }
  }

  async function removeEntryOn(date, id) {
    const nextDay = (logs[date] || []).filter((e) => e.id !== id);
    const nextLogs = { ...logs, [date]: nextDay };
    const ok = await persist({ logs: nextLogs });

    if (ok) {
      setLogs(nextLogs);
    } else {
      setEntryError("Couldn't remove this entry. Please try again.");
    }
  }

  const planExpired = !planDateFrom || !planDateTo || planDateTo < todayStr() || ownPlanStatus !== "active";

  const historyDayDates = useMemo(() => {
    if (planExpired) return [];
    const count = daysBetweenStr(planDateFrom, planDateTo) + 1;
    const dates = [];
    for (let i = 0; i < count; i++) dates.push(addDaysStr(planDateFrom, i));
    return dates;
  }, [planExpired, planDateFrom, planDateTo]);

  const historyDayData = useMemo(() => {
    return historyDayDates.map((date) => {
      const entries = logs[date] || [];
      const actualTotal = entries.reduce((sum, e) => sum + (e.calories || 0), 0);
      return { date, actualTotal, hasEntries: entries.length > 0 };
    });
  }, [historyDayDates, logs]);

  const historyMaxScale = useMemo(() => {
    const maxActual = historyDayData.reduce((max, d) => Math.max(max, d.actualTotal), 0);
    return Math.max(effectivePlan.calories, maxActual, 1) * 1.1;
  }, [historyDayData, effectivePlan.calories]);

  if (session === undefined) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", padding: "3rem", textAlign: "center", color: INK_SOFT }}>
        Checking session…
      </div>
    );
  }

  if (session === null) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", background: PAPER, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <div style={{ background: PANEL, border: `1px solid ${GRID}`, borderRadius: 6, padding: "2rem", width: "100%", maxWidth: 360 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            nutrition tracker
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, margin: "0 0 20px 0" }}>
            {authMode === "signup" ? "Create an account" : "Log in"}
          </h1>

          <label style={labelStyle}>Email</label>
          <input
            type="email"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            style={inputStyle}
            autoComplete="email"
          />

          <label style={labelStyle}>Password</label>
          <input
            type="password"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            style={inputStyle}
            autoComplete={authMode === "signup" ? "new-password" : "current-password"}
          />
          {authMode === "signup" && (
            <div style={{ marginTop: -10, marginBottom: 14, fontSize: 11, color: INK_SOFT, lineHeight: 1.4 }}>
              At least 8 characters, with an uppercase letter, lowercase letter, number, and special character.
            </div>
          )}

          <button
            onClick={handleAuthSubmit}
            disabled={authBusy}
            style={{ ...primaryButtonStyle, width: "100%", marginTop: 4, opacity: authBusy ? 0.6 : 1 }}
          >
            {authBusy ? "Please wait…" : authMode === "signup" ? "Sign up" : "Log in"}
          </button>

          {authError && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
              {authError}
            </div>
          )}
          {authNotice && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: TEAL_SOFT, color: TEAL, borderRadius: 4, fontSize: 12 }}>
              {authNotice}
            </div>
          )}

          <div style={{ marginTop: 16, textAlign: "center", fontSize: 12.5, color: INK_SOFT }}>
            {authMode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => { setAuthMode(authMode === "signup" ? "login" : "signup"); setAuthError(null); setAuthNotice(null); }}
              style={{ background: "none", border: "none", color: TEAL, fontWeight: 600, cursor: "pointer", padding: 0, fontSize: 12.5 }}
            >
              {authMode === "signup" ? "Log in" : "Sign up"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div style={{ fontFamily: "'Inter', sans-serif", padding: "3rem", textAlign: "center", color: INK_SOFT }}>
        Loading your data…
      </div>
    );
  }

  const totalClientsCount = clients.length;
  const activeClientsCount = clients.filter((c) => c.active).length;
  const invitedClientsCount = totalClientsCount - activeClientsCount;

  const CLIENTS_PAGE_SIZE = 10;
  const totalClientsPages = Math.max(1, Math.ceil(clients.length / CLIENTS_PAGE_SIZE));
  const clampedClientsPage = Math.min(clientsPage, totalClientsPages);
  const pagedClients = clients.slice(
    (clampedClientsPage - 1) * CLIENTS_PAGE_SIZE,
    clampedClientsPage * CLIENTS_PAGE_SIZE
  );

  const activePlanClients = clients.filter((c) => c.active);

  const chatUnreadTotal = Object.values(chatUnreadByClient).reduce((sum, n) => sum + n, 0);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: PAPER, color: INK, padding: "2rem", maxWidth: 960, margin: "0 auto" }}>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${GRID}`, paddingBottom: 16, marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            nutrition tracker
          </div>
          <h1 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 24, fontWeight: 700, margin: 0 }}>
            {view === "setup" && "Configuration"}
            {view === "log" && "Daily log"}
            {view === "history" && "History"}
            {view === "home" && "Home"}
            {view === "clients" && "Clients"}
            {view === "plans" && "Plans"}
            {view === "administration" && "Administration"}
            {view === "chat" && "Chat"}
            {view === "notifications" && "Notifications"}
            {view === "client-detail" && "Client details"}
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
            {saving ? "saving…" : "saved"}
          </span>
          <button onClick={handleLogout} style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px" }}>
            Log out
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "10px 14px", background: PANEL, border: `1px solid ${GRID}`, borderRadius: 6, marginBottom: 20 }}>
        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          <label style={labelStyle}>Suggest a new idea</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Have an idea for the app?"
              value={ideaText}
              onChange={(e) => setIdeaText(e.target.value)}
              style={{ ...smallInputStyle, flex: 1 }}
            />
            <button onClick={() => submitFeedback("idea")} style={{ ...secondaryButtonStyle, fontSize: 11, padding: "7px 10px" }}>
              Send
            </button>
          </div>
          {ideaFlash && <div style={{ marginTop: 4, fontSize: 11, color: GREEN }}>Thanks — got it!</div>}
          {ideaError && <div style={{ marginTop: 4, fontSize: 11, color: RED }}>{ideaError}</div>}
        </div>
        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          <label style={labelStyle}>Report a bug</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="Found something broken?"
              value={bugText}
              onChange={(e) => setBugText(e.target.value)}
              style={{ ...smallInputStyle, flex: 1 }}
            />
            <button onClick={() => submitFeedback("bug")} style={{ ...secondaryButtonStyle, fontSize: 11, padding: "7px 10px" }}>
              Send
            </button>
          </div>
          {bugFlash && <div style={{ marginTop: 4, fontSize: 11, color: GREEN }}>Thanks — got it!</div>}
          {bugError && <div style={{ marginTop: 4, fontSize: 11, color: RED }}>{bugError}</div>}
        </div>
      </div>

      {roleId !== 2 && (
      <>
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {[
          { id: "setup", label: "Configuration" },
          { id: "log", label: "Daily log" },
          { id: "history", label: "History" },
          ...(roleId === 3 ? [{ id: "chat", label: "Chat" }] : []),
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 4,
              border: `1px solid ${view === t.id ? TEAL : GRID}`,
              background: view === t.id ? TEAL_SOFT : PANEL,
              color: view === t.id ? TEAL : INK_SOFT,
              fontFamily: "'Space Grotesk', sans-serif",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.label}
            {t.id === "chat" && chatUnreadTotal > 0 && <UnreadBadge count={chatUnreadTotal} />}
          </button>
        ))}
      </div>

      {view === "setup" && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${GRID}`, paddingBottom: 12 }}>
            {[
              { id: "profile", label: "Profile & program" },
              { id: "measurements", label: "Measurements" },
              { id: "photos", label: "Progress photos" },
              { id: "foodListConfig", label: "Configure your food list" },
              { id: "foodMaterials", label: "Create a plan" },
              { id: "notifications", label: "Notifications" },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setConfigTab(t.id)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 4,
                  border: `1px solid ${configTab === t.id ? TEAL : GRID}`,
                  background: configTab === t.id ? TEAL_SOFT : PANEL,
                  color: configTab === t.id ? TEAL : INK_SOFT,
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {configTab === "profile" && (
            <div style={panelStyle}>
              <SectionTitle>Profile & program</SectionTitle>

              <label style={labelStyle}>Sex</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {["male", "female"].map((s) => (
                  <button key={s} onClick={() => setProfile({ ...profile, sex: s })} style={toggleStyle(profile.sex === s)}>
                    {s === "male" ? "Male" : "Female"}
                  </button>
                ))}
              </div>

              <label style={labelStyle}>Date of birth (optional)</label>
              <input
                type="date"
                value={profile.dateOfBirth || ""}
                max={todayStr()}
                onChange={(e) => {
                  const val = e.target.value;
                  const computedAge = calcAgeFromDOB(val);
                  setProfile({ ...profile, dateOfBirth: val, age: computedAge !== null ? computedAge : profile.age });
                }}
                style={inputStyle}
              />
              {profile.dateOfBirth && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: INK_SOFT, marginTop: -8, marginBottom: 14 }}>
                  Age: {profile.age} (calculated from date of birth)
                </div>
              )}

              <label style={labelStyle}>Age{profile.dateOfBirth ? " (calculated)" : ""}</label>
              <input
                type="number"
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                style={profile.dateOfBirth ? { ...inputStyle, background: GRID, color: INK_SOFT } : inputStyle}
                readOnly={!!profile.dateOfBirth}
                disabled={!!profile.dateOfBirth}
              />

              <label style={labelStyle}>Weight (kg)</label>
              <input type="number" value={profile.weightKg} onChange={(e) => setProfile({ ...profile, weightKg: e.target.value })} style={inputStyle} />

              <label style={labelStyle}>Height (cm)</label>
              <input type="number" value={profile.heightCm} onChange={(e) => setProfile({ ...profile, heightCm: e.target.value })} style={inputStyle} />

              <label style={labelStyle}>Activity level</label>
              <select value={profile.activity} onChange={(e) => setProfile({ ...profile, activity: e.target.value })} style={inputStyle}>
                {ACTIVITY_LEVELS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>

              <label style={labelStyle}>Health issues or conditions (optional)</label>
              <textarea
                value={profile.healthNotes || ""}
                onChange={(e) => setProfile({ ...profile, healthNotes: e.target.value })}
                placeholder="e.g. knee injury, hypertension, food allergies…"
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "'IBM Plex Mono', monospace" }}
              />

              <label style={labelStyle}>Goal</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {["cut", "maintain", "bulk"].map((g) => (
                  <button key={g} onClick={() => setGoal({ ...goal, type: g })} style={{ ...toggleStyle(goal.type === g), flex: 1 }}>
                    {g === "cut" ? "Cut" : g === "bulk" ? "Bulk" : "Maintain"}
                  </button>
                ))}
              </div>

              {goal.type !== "maintain" && (
                <>
                  <label style={labelStyle}>Pace</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    {RATES.map((r) => (
                      <button key={r.id} onClick={() => setGoal({ ...goal, rate: r.id })} style={{ ...toggleStyle(goal.rate === r.id), flex: 1, fontSize: 11 }}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {bmiInfo && (
                <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 12, marginTop: 4, marginBottom: 4 }}>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, marginBottom: 10, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Weight vs. international standard (BMI)
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      padding: "8px 10px",
                      background: STATUS_META[bmiInfo.status].soft,
                      borderRadius: 4,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, color: STATUS_META[bmiInfo.status].color, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {bmiInfo.category}
                    </span>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: STATUS_META[bmiInfo.status].color }}>
                      BMI {bmiInfo.bmi.toFixed(1)}
                      {bmiInfo.diffLabel !== "within" && ` · ${bmiInfo.percentDiff.toFixed(1)}% ${bmiInfo.diffLabel} standard`}
                    </span>
                  </div>

                  <p style={{ fontSize: 12.5, lineHeight: 1.6, color: INK, margin: "0 0 4px 0" }}>
                    {bmiInfo.sentence}
                  </p>
                  <p style={{ fontSize: 10.5, lineHeight: 1.5, color: INK_SOFT, margin: 0, fontStyle: "italic" }}>
                    BMI is a general screening measure, not a diagnosis — it doesn't account for muscle mass, body composition, or individual health context.
                  </p>
                </div>
              )}

              <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 12, marginTop: 4 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    padding: "8px 10px",
                    background: TEAL_SOFT,
                    borderRadius: 4,
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 700, color: TEAL, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {planOverride
                      ? (JSON.stringify(planOverride) === JSON.stringify(savedPlanOverride) ? "Active plan (manual)" : "Proposed plan (manual)")
                      : "Active plan (calculated)"}
                  </span>
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: TEAL }}>
                    {effectivePlan.calories} kcal · P{effectivePlan.protein} C{effectivePlan.carbs} F{effectivePlan.fat}
                  </span>
                </div>

                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT, marginBottom: 8 }}>
                  Calculated plan (from your profile & goal): {computedPlan.calories} kcal · P{computedPlan.protein} C{computedPlan.carbs} F{computedPlan.fat}
                </div>
                <button
                  onClick={() => { setPlanOverride(null); setSavedPlanOverride(null); persist({ planOverride: null }); }}
                  style={{ ...toggleStyle(!planOverride), fontSize: 11, marginBottom: 10 }}
                >
                  Use calculated plan
                </button>

                <label style={labelStyle}>Or set a manual daily target (kcal)</label>
                <input
                  type="number"
                  placeholder="e.g. 2200"
                  value={planOverride ? planOverride.calories : ""}
                  onChange={(e) => {
                    const cal = Number(e.target.value) || 0;
                    const manual = {
                      calories: cal,
                      protein: computedPlan.protein,
                      carbs: Math.round(Math.max(cal - computedPlan.protein * 4 - computedPlan.fat * 9, 0) / 4),
                      fat: computedPlan.fat,
                    };
                    setPlanOverride(cal > 0 ? manual : null);
                  }}
                  style={inputStyle}
                />
              </div>

              <button onClick={saveSetup} style={{ ...primaryButtonStyle, marginTop: 8, width: "auto", background: GREEN, border: `1px solid ${GREEN}` }}>
                {setupSavedFlash ? <Check size={14} strokeWidth={2.5} /> : <Save size={14} strokeWidth={2.5} />}
                {setupSavedFlash ? "Configuration saved" : "Save configuration"}
              </button>
              {saveError && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                  {saveError}
                </div>
              )}
            </div>
          )}

          {configTab === "measurements" && (
            <div style={panelStyle}>
              <SectionTitle>Measurements</SectionTitle>

              <label style={labelStyle}>Date</label>
              <input
                type="date"
                value={newMeasurement.date}
                max={todayStr()}
                onChange={(e) => setNewMeasurement({ ...newMeasurement, date: e.target.value })}
                style={inputStyle}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {MEASUREMENT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label style={labelStyle}>{f.label} (cm)</label>
                    <input
                      type="number"
                      value={newMeasurement[f.key]}
                      onChange={(e) => setNewMeasurement({ ...newMeasurement, [f.key]: e.target.value })}
                      style={{ ...inputStyle, marginBottom: 0 }}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={addMeasurement}
                disabled={measurementSaving}
                style={{ ...primaryButtonStyle, marginTop: 14, width: "auto", background: GREEN, border: `1px solid ${GREEN}` }}
              >
                <Plus size={14} strokeWidth={2.5} />
                {measurementSaving ? "Saving…" : "Add measurement"}
              </button>
              {measurementError && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                  {measurementError}
                </div>
              )}

              <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 12, marginTop: 18 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, marginBottom: 10, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Past entries
                </div>

                {measurements.length === 0 ? (
                  <div style={{ fontSize: 12, color: INK_SOFT }}>No measurements logged yet.</div>
                ) : (
                  measurements.map((m) => (
                    <div key={m.id} style={{ padding: "8px 0", borderBottom: `1px solid ${GRID}` }}>
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12.5, fontWeight: 600, marginBottom: 3 }}>
                        {shortDayLabel(String(m.date).slice(0, 10))}
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: INK_SOFT }}>
                        {MEASUREMENT_FIELDS.filter((f) => m[f.key] !== null && m[f.key] !== undefined)
                          .map((f) => `${f.label} ${m[f.key]}cm`)
                          .join(" · ") || "No values recorded"}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {configTab === "photos" && (
            <div style={panelStyle}>
              <SectionTitle>Progress photos</SectionTitle>

              <label style={labelStyle}>Date</label>
              <input
                type="date"
                value={newPhotoDate}
                max={todayStr()}
                onChange={(e) => setNewPhotoDate(e.target.value)}
                style={inputStyle}
              />

              <label style={labelStyle}>Photo</label>
              <input
                type="file"
                accept="image/*"
                ref={photoFileInputRef}
                onChange={(e) => setPhotoFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                style={{ ...inputStyle, padding: "6px 0" }}
              />

              <button
                onClick={uploadProgressPhoto}
                disabled={photoUploading || !photoFile}
                style={{ ...primaryButtonStyle, marginTop: 4, width: "auto", background: GREEN, border: `1px solid ${GREEN}` }}
              >
                <Save size={14} strokeWidth={2.5} />
                {photoUploading ? "Uploading…" : "Upload photo"}
              </button>
              {photoError && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                  {photoError}
                </div>
              )}

              <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 12, marginTop: 18 }}>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, marginBottom: 10, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Past photos
                </div>

                {photos.length === 0 ? (
                  <div style={{ fontSize: 12, color: INK_SOFT }}>No progress photos yet.</div>
                ) : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
                    {photos.map((p) => (
                      <div key={p.id}>
                        {p.url ? (
                          <img
                            src={p.url}
                            alt={`Progress photo from ${p.taken_at}`}
                            style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 4, border: `1px solid ${GRID}`, display: "block" }}
                          />
                        ) : (
                          <div style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 4, border: `1px solid ${GRID}`, background: PAPER }} />
                        )}
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: INK_SOFT, marginTop: 4, textAlign: "center" }}>
                          {shortDayLabel(String(p.taken_at).slice(0, 10))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {configTab === "foodMaterials" && (
            <div style={panelStyle}>
              <SectionTitle>Create a plan</SectionTitle>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                Define your plan
              </div>
              <div style={{ marginBottom: 14 }}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 8px",
                    background: TEAL_SOFT,
                    color: TEAL,
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  This plan's daily target: {effectivePlan.calories} kcal
                </span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: INK_SOFT,
                  lineHeight: 1.5,
                  background: "#EEEEEC",
                  border: `1px solid ${GRID}`,
                  borderRadius: 4,
                  padding: "10px 12px",
                  marginBottom: 14,
                }}
              >
                Select a food from your list, then enter the grams — calories are calculated automatically from the calories per 100g you set in "Configure your food list".
              </div>

              <label style={labelStyle}>Plan name</label>
              <input
                type="text"
                placeholder="e.g. Cutting phase — September"
                value={planName}
                onChange={(e) => {
                  const val = e.target.value;
                  setPlanName(val);
                  persist({ planName: val });
                }}
                style={{ ...inputStyle, width: "50%" }}
              />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
                <div>
                  <label style={labelStyle}>Date from</label>
                  <input
                    type="date"
                    value={planDateFrom}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPlanDateFrom(val);
                      if (!planDateTo || val <= planDateTo) persist({ planDateFrom: val });
                    }}
                    style={{ ...inputStyle, marginBottom: 0 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Date to</label>
                  <input
                    type="date"
                    value={planDateTo}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPlanDateTo(val);
                      if (!planDateFrom || val >= planDateFrom) persist({ planDateTo: val });
                    }}
                    style={{ ...inputStyle, marginBottom: 0 }}
                  />
                </div>
              </div>
              {planDateFrom && planDateTo && planDateTo < planDateFrom ? (
                <div style={{ marginBottom: 16, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                  "Date to" can't be earlier than "Date from". Please enter a valid date range.
                </div>
              ) : (
                <div style={{ marginBottom: 16 }} />
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>Food name</label>
                <select
                  value={newFood.personalFoodId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setNewFood({ ...newFood, personalFoodId: id, grams: "", calories: 0 });
                  }}
                  style={inputStyle}
                  disabled={personalFoods.length === 0}
                >
                  <option value="">{personalFoods.length === 0 ? "No foods configured yet" : "Select a food…"}</option>
                  {personalFoods.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>

                <label style={labelStyle}>Grams</label>
                <input
                  type="number"
                  placeholder="Grams"
                  value={newFood.grams}
                  onChange={(e) => {
                    const grams = e.target.value;
                    const match = personalFoods.find((f) => f.id === newFood.personalFoodId);
                    const numGrams = Number(grams) || 0;
                    const calories = match && match.calPer100g ? Math.round((match.calPer100g * numGrams) / 100) : 0;
                    setNewFood({ ...newFood, grams, calories });
                  }}
                  style={inputStyle}
                />

                <label style={labelStyle}>Calories</label>
                <input
                  type="number"
                  placeholder="Calories"
                  value={newFood.calories}
                  readOnly
                  style={{ ...inputStyle, background: PAPER, color: INK_SOFT, cursor: "not-allowed" }}
                />

                <label style={labelStyle}>Meal</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {MEALS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setNewFood({ ...newFood, meal: m })}
                      style={{ ...toggleStyle(newFood.meal === m), fontSize: 11, padding: "6px 10px" }}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <label style={labelStyle}>Course</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                  {COURSES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewFood({ ...newFood, course: c })}
                      style={{ ...toggleStyle(newFood.course === c), fontSize: 11, padding: "6px 10px" }}
                    >
                      {c}
                    </button>
                  ))}
                </div>

                <button onClick={addFood} style={{ ...secondaryButtonStyle, width: "auto", background: GREEN, border: `1px solid ${GREEN}`, color: "#FFFFFF" }}>
                  <Plus size={14} strokeWidth={2.5} /> Add food
                </button>

                {addFoodError && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                    {addFoodError}
                  </div>
                )}
              </div>

              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {foods.length === 0 && <div style={{ fontSize: 12, color: INK_SOFT }}>No foods added yet.</div>}
                {MEALS.map((mealName) => {
                  const mealFoods = foods.filter((f) => f.meal === mealName);
                  if (mealFoods.length === 0) return null;

                  const mealTotalCal = mealFoods.reduce((sum, f) => sum + f.calories, 0);

                  return (
                    <div key={mealName} style={{ marginBottom: 16 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          padding: "4px 8px",
                          background: TEAL_SOFT,
                          borderRadius: 4,
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontFamily: "'Space Grotesk', sans-serif",
                            fontSize: 14,
                            fontWeight: 700,
                            color: TEAL,
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                          }}
                        >
                          {mealName}
                        </span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL }}>
                          {mealTotalCal} kcal total
                        </span>
                      </div>
                      {COURSES.map((courseName) => {
                        const courseFoods = mealFoods.filter((f) => (f.course || "Main") === courseName);
                        if (courseFoods.length === 0) return null;

                        return (
                          <div key={courseName} style={{ marginBottom: 8 }}>
                            <div
                              style={{
                                fontFamily: "'Space Grotesk', sans-serif",
                                fontSize: 11,
                                fontWeight: 700,
                                color: GREEN,
                                background: GREEN_SOFT,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                padding: "2px 8px",
                                borderRadius: 4,
                                display: "inline-block",
                              }}
                            >
                              {courseName}
                            </div>
                            {courseFoods.map((f) => (
                              <div key={f.id} style={foodRowStyle}>
                                <div>
                                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                                    {f.grams}g · {f.calories} kcal
                                  </div>
                                </div>
                                <button onClick={() => removeFood(f.id)} style={iconButtonStyle} aria-label="Remove food">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {configTab === "foodListConfig" && (
            <div style={panelStyle}>
              <SectionTitle>Configure your food list</SectionTitle>
              <div
                style={{
                  fontSize: 12,
                  color: INK_SOFT,
                  lineHeight: 1.5,
                  background: "#EEEEEC",
                  border: `1px solid ${GRID}`,
                  borderRadius: 4,
                  padding: "10px 12px",
                  marginBottom: 14,
                }}
              >
                Build your own personal food database. Add each food's calories per 100g once here, and it becomes selectable in the Food materials tab.
              </div>

              <label style={labelStyle}>Food name</label>
              <input
                placeholder="Food name"
                value={newPersonalFood.name}
                onChange={(e) => setNewPersonalFood({ ...newPersonalFood, name: e.target.value })}
                style={inputStyle}
              />
              <label style={labelStyle}>Calories per 100g (optional)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Calories per 100g"
                value={newPersonalFood.calPer100g}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^0-9.]/g, "");
                  const firstDot = raw.indexOf(".");
                  const sanitized =
                    firstDot === -1 ? raw : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
                  setNewPersonalFood({ ...newPersonalFood, calPer100g: sanitized });
                }}
                style={inputStyle}
              />
              <button onClick={addPersonalFood} style={{ ...secondaryButtonStyle, width: "auto", background: GREEN, border: `1px solid ${GREEN}`, color: "#FFFFFF" }}>
                <Plus size={14} strokeWidth={2.5} /> Add to list
              </button>
              {personalFoodError && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                  {personalFoodError}
                </div>
              )}

              <div style={{ marginTop: 16, maxHeight: 340, overflowY: "auto" }}>
                {personalFoods.length === 0 && <div style={{ fontSize: 12, color: INK_SOFT }}>No foods in your list yet.</div>}
                {personalFoods.map((f) => (
                  <div key={f.id} style={foodRowStyle}>
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                        {f.calPer100g ? `${f.calPer100g} kcal / 100g` : "No calories set"}
                      </div>
                    </div>
                    <button onClick={() => removePersonalFood(f.id)} style={iconButtonStyle} aria-label="Remove food">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {configTab === "notifications" && (
            <div style={panelStyle}>
              <SectionTitle>Notifications</SectionTitle>

              {!notificationSettings ? (
                <div style={{ fontSize: 12, color: INK_SOFT }}>Loading notification settings…</div>
              ) : (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 14px",
                      background: notificationSettings.target ? GREEN_SOFT : "#EEEEEC",
                      borderRadius: 4,
                      marginBottom: 14,
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontSize: 13,
                          fontWeight: 600,
                          color: notificationSettings.target ? GREEN : INK_SOFT,
                        }}
                      >
                        {notificationSettings.target ? "Telegram: Connected ✓" : "Telegram: Not connected"}
                      </div>
                      {!notificationSettings.target && (
                        <div style={{ fontSize: 11.5, color: INK_SOFT, marginTop: 4, maxWidth: 320, lineHeight: 1.4 }}>
                          Click below, then press Send in Telegram to connect your account.
                        </div>
                      )}
                    </div>
                    <button
                      onClick={checkTelegramConnection}
                      style={{ ...secondaryButtonStyle, fontSize: 11, padding: "6px 10px", flexShrink: 0 }}
                      disabled={saving}
                    >
                      Check connection
                    </button>
                  </div>

                  {!notificationSettings.target && (
                    <button
                      onClick={connectTelegram}
                      style={{ ...primaryButtonStyle, width: "auto", marginBottom: 20 }}
                      disabled={saving}
                    >
                      Connect Telegram
                    </button>
                  )}

                  <div style={{ borderTop: `1px solid ${GRID}`, paddingTop: 16 }}>
                    <label style={labelStyle}>Send me a daily summary</label>
                    <button
                      onClick={() =>
                        updateNotificationSettings({ daily_summary_enabled: !notificationSettings.daily_summary_enabled })
                      }
                      style={{ ...toggleStyle(!!notificationSettings.daily_summary_enabled), marginBottom: 14 }}
                      disabled={saving}
                    >
                      {notificationSettings.daily_summary_enabled ? "On" : "Off"}
                    </button>

                    {notificationSettings.daily_summary_enabled && (
                      <>
                        <label style={labelStyle}>At what time</label>
                        <input
                          type="time"
                          value={notificationSettings.daily_summary_time || ""}
                          onChange={(e) => updateNotificationSettings({ daily_summary_time: e.target.value })}
                          style={inputStyle}
                          disabled={saving}
                        />
                      </>
                    )}

                    <label style={labelStyle}>Warn me when I'm approaching my limit</label>
                    <button
                      onClick={() =>
                        updateNotificationSettings({ threshold_enabled: !notificationSettings.threshold_enabled })
                      }
                      style={{ ...toggleStyle(!!notificationSettings.threshold_enabled), marginBottom: 14 }}
                      disabled={saving}
                    >
                      {notificationSettings.threshold_enabled ? "On" : "Off"}
                    </button>

                    {notificationSettings.threshold_enabled && (
                      <>
                        <label style={labelStyle}>Warn me at this % of my daily target</label>
                        <input
                          type="number"
                          value={thresholdPercentDraft}
                          onChange={(e) => setThresholdPercentDraft(e.target.value)}
                          onBlur={() => {
                            if (thresholdPercentDraft !== (notificationSettings.threshold_percent ?? "")) {
                              updateNotificationSettings({ threshold_percent: thresholdPercentDraft });
                            }
                          }}
                          style={inputStyle}
                          disabled={saving}
                        />
                      </>
                    )}
                  </div>

                  {saveError && (
                    <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                      {saveError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {view === "log" && (
        <>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={panelStyle}>
            <SectionTitle>Add meal</SectionTitle>

            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={selectedDate}
              min={threeDaysAgoStr()}
              max={todayStr()}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>Log this entry under</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
              {MEALS.map((m) => (
                <button
                  key={m}
                  onClick={() => setLogMeal(m)}
                  style={{ ...toggleStyle(logMeal === m), fontSize: 11, padding: "6px 10px" }}
                >
                  {m}
                </button>
              ))}
            </div>

            <label style={labelStyle}>From food list</label>
            <select
              value={entryFoodId}
              onChange={(e) => setEntryFoodId(e.target.value)}
              style={inputStyle}
              disabled={uniquePlanFoodNames.length === 0}
            >
              <option value="">{uniquePlanFoodNames.length === 0 ? "No foods configured yet" : "Select a food…"}</option>
              {uniquePlanFoodNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            <label style={labelStyle}>Or log anything not in the list (manual entry)</label>
            <input
              placeholder="Item name"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              style={inputStyle}
            />

            <label style={labelStyle}>Grams</label>
            <input type="number" placeholder="Grams" value={entryGrams} onChange={(e) => setEntryGrams(e.target.value)} style={inputStyle} />

            {customName && !entryFoodId && (
              <>
                <label style={labelStyle}>Calories per 100 gram</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="Calories per 100 gram"
                  value={entryCalPer100g}
                  onChange={(e) => setEntryCalPer100g(e.target.value.replace(/[^0-9]/g, ""))}
                  style={inputStyle}
                />
              </>
            )}

            <label style={labelStyle}>Calories per your entered grams</label>
            <input
              type="number"
              value={entryCalories}
              readOnly
              style={{ ...inputStyle, background: PAPER, color: INK_SOFT, cursor: "not-allowed" }}
            />

            <button onClick={addEntry} style={{ ...secondaryButtonStyle, width: "auto", background: GREEN, border: `1px solid ${GREEN}`, color: "#FFFFFF" }}>
              <Plus size={14} strokeWidth={2.5} /> Log this item
            </button>
            {entryError && (
              <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                {entryError}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                My meals
              </div>

              <label style={labelStyle}>Filter by</label>
              <select
                value={tableFilterType}
                onChange={(e) => {
                  setTableFilterType(e.target.value);
                  setTableFilterDateFrom("");
                  setTableFilterDateTo("");
                  setTableFilterMeal("");
                  setTableFilterFood("");
                  setTablePage(1);
                }}
                style={inputStyle}
              >
                <option value="">No filter</option>
                <option value="date">Date</option>
                <option value="meal">Meal</option>
                <option value="food">Food</option>
              </select>

              {tableFilterType === "date" && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                    <div>
                      <label style={labelStyle}>Date from</label>
                      <input
                        type="date"
                        value={tableFilterDateFrom}
                        onChange={(e) => { setTableFilterDateFrom(e.target.value); setTablePage(1); }}
                        style={{ ...inputStyle, marginBottom: 0 }}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Date to</label>
                      <input
                        type="date"
                        value={tableFilterDateTo}
                        onChange={(e) => { setTableFilterDateTo(e.target.value); setTablePage(1); }}
                        style={{ ...inputStyle, marginBottom: 0 }}
                      />
                    </div>
                  </div>
                  {tableFilterDateFrom && tableFilterDateTo && tableFilterDateTo < tableFilterDateFrom && (
                    <div style={{ marginBottom: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                      "Date to" can't be earlier than "Date from". Please enter a valid date range.
                    </div>
                  )}
                </>
              )}

              {tableFilterType === "meal" && (
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Meal</label>
                  <select
                    value={tableFilterMeal}
                    onChange={(e) => { setTableFilterMeal(e.target.value); setTablePage(1); }}
                    style={{ ...inputStyle, marginBottom: 0 }}
                  >
                    <option value="">All meals</option>
                    {MEALS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              {tableFilterType === "food" && (
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle}>Food</label>
                  <select
                    value={tableFilterFood}
                    onChange={(e) => { setTableFilterFood(e.target.value); setTablePage(1); }}
                    style={{ ...inputStyle, marginBottom: 0 }}
                  >
                    <option value="">All foods</option>
                    {uniqueFoodNames.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}

              {tableFilterType && (
                <button
                  onClick={() => {
                    setTableFilterType("");
                    setTableFilterDateFrom("");
                    setTableFilterDateTo("");
                    setTableFilterMeal("");
                    setTableFilterFood("");
                    setTablePage(1);
                  }}
                  style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px", marginBottom: 10 }}
                >
                  Clear filter
                </button>
              )}

              {filteredMealEntries.length === 0 && <div style={{ fontSize: 12, color: INK_SOFT }}>No meals match this view yet.</div>}
              {filteredMealEntries.length > 0 && (
                <>
                  <div style={{ border: `1px solid ${GRID}`, borderRadius: 4 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: TEAL_SOFT }}>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Meal</th>
                          <th style={thStyle}>Food</th>
                          <th style={thStyle}>Grams (g)</th>
                          <th style={thStyle}>Calories (kcal)</th>
                          <th style={thStyle}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedMealEntries.map((e) => (
                          <tr key={e.id} style={{ borderTop: `1px solid ${GRID}` }}>
                            <td style={tdStyle}>{e.date}</td>
                            <td style={tdStyle}>{e.meal || "—"}</td>
                            <td style={{ ...tdStyle, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>{e.name}</td>
                            <td style={tdStyle}>{e.grams || 0}</td>
                            <td style={tdStyle}>{e.calories}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              <button onClick={() => removeEntryOn(e.date, e.id)} style={iconButtonStyle} aria-label="Remove entry">
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                    <button
                      onClick={() => setTablePage((p) => Math.max(1, p - 1))}
                      disabled={clampedTablePage <= 1}
                      style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px", opacity: clampedTablePage <= 1 ? 0.5 : 1, cursor: clampedTablePage <= 1 ? "not-allowed" : "pointer" }}
                    >
                      Previous
                    </button>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                      Page {clampedTablePage} of {totalTablePages}
                    </span>
                    <button
                      onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
                      disabled={clampedTablePage >= totalTablePages}
                      style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px", opacity: clampedTablePage >= totalTablePages ? 0.5 : 1, cursor: clampedTablePage >= totalTablePages ? "not-allowed" : "pointer" }}
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div style={panelStyle}>
            <SectionTitle>Today vs plan</SectionTitle>
            <MetricRow label="Calories" actual={dayTotals.calories} target={effectivePlan.calories} unit=" kcal" />
            <MetricRow label="Protein" actual={dayTotals.protein} target={effectivePlan.protein} unit="g" />
            <MetricRow label="Carbs" actual={dayTotals.carbs} target={effectivePlan.carbs} unit="g" />
            <MetricRow label="Fat" actual={dayTotals.fat} target={effectivePlan.fat} unit="g" />
            <div style={{ fontSize: 11, color: INK_SOFT, marginTop: 12, lineHeight: 1.5 }}>
              Green means within {TOLERANCE * 100}% of target. Red means over. Yellow means under.
            </div>
          </div>
        </div>

        <div style={{ ...panelStyle, marginTop: 20 }}>
          <SectionTitle>Plan comparison</SectionTitle>

          {ownPlanStatus !== "active" ? (
            <div style={{ fontSize: 12, color: INK_SOFT }}>No active plan configured.</div>
          ) : (
          <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <button
              onClick={goToPrevComparisonDay}
              disabled={!planDateFrom || comparisonDayIndex <= 1}
              style={{
                ...secondaryButtonStyle,
                fontSize: 11,
                padding: "5px 10px",
                opacity: !planDateFrom || comparisonDayIndex <= 1 ? 0.5 : 1,
                cursor: !planDateFrom || comparisonDayIndex <= 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Day {comparisonDayIndex} of {planTotalDays}
              </div>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700 }}>
                {comparisonDate}
              </div>
            </div>
            <button
              onClick={goToNextComparisonDay}
              disabled={!planDateTo || comparisonDayIndex >= planTotalDays}
              style={{
                ...secondaryButtonStyle,
                fontSize: 11,
                padding: "5px 10px",
                opacity: !planDateTo || comparisonDayIndex >= planTotalDays ? 0.5 : 1,
                cursor: !planDateTo || comparisonDayIndex >= planTotalDays ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>

          {actualEntriesForDay.length === 0 ? (
            <div style={{ fontSize: 12, color: INK_SOFT }}>Nothing logged for this day yet.</div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px 18px",
                  background: STATUS_META[dailyStatus].soft,
                  borderRadius: 6,
                  marginBottom: 20,
                }}
              >
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: STATUS_META[dailyStatus].color, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                    Daily total
                  </div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28, fontWeight: 700 }}>
                    {dailyActualTotal}
                    <span style={{ fontSize: 15, fontWeight: 600, color: INK_SOFT }}> / {effectivePlan.calories} kcal</span>
                  </div>
                </div>
                <StatusBadge status={dailyStatus} />
              </div>

              {mealComparisons.map(({ mealName, loggedFoodRows, mealActualTotal, mealConfiguredTotal }) => {
                return (
                  <div key={mealName} style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        padding: "4px 8px",
                        background: TEAL_SOFT,
                        borderRadius: 4,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontSize: 14,
                          fontWeight: 700,
                          color: TEAL,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        {mealName}
                      </span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL }}>
                        {mealActualTotal} / {mealConfiguredTotal} kcal
                      </span>
                    </div>

                    {loggedFoodRows.map((row) => {
                      const foodStatus = statusFor(row.actualCalories, row.configuredCalories);

                      return (
                        <div key={row.name} style={foodRowStyle}>
                          <div>
                            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{row.name}</div>
                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                              {row.matched
                                ? `${row.actualGrams} / ${row.configuredGrams} g · ${row.actualCalories} / ${row.configuredCalories} kcal`
                                : `${row.actualGrams} g · ${row.actualCalories} kcal`}
                            </div>
                          </div>
                          {row.matched ? (
                            <StatusBadge status={foodStatus} />
                          ) : (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "3px 8px",
                                borderRadius: 4,
                                background: "#EEEEEC",
                                color: INK_SOFT,
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontSize: 10.5,
                                fontWeight: 600,
                                textTransform: "uppercase",
                                letterSpacing: 0.4,
                              }}
                            >
                              Not tracked
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
          </>
          )}
        </div>
        </>
      )}

      {view === "history" && (
        <div style={panelStyle}>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
            Daily total vs configured target
          </div>

          {planExpired ? (
            <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 10 }}>No active plan configured.</div>
          ) : (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT, marginBottom: 20 }}>
                dashed line = {effectivePlan.calories} kcal target
              </div>

              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: historyDayDates.length * (HISTORY_COL_WIDTH + HISTORY_COL_GAP), paddingTop: 20 }}>
                  <div style={{ position: "relative", height: HISTORY_CHART_HEIGHT }}>
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${100 - (effectivePlan.calories / historyMaxScale) * 100}%`,
                        borderTop: `2px dashed ${INK_SOFT}`,
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        top: `${100 - (effectivePlan.calories / historyMaxScale) * 100}%`,
                        left: 0,
                        transform: "translateY(-100%)",
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 10,
                        color: INK_SOFT,
                        background: PANEL,
                        padding: "0 4px 2px 0",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {effectivePlan.calories} kcal
                    </span>
                    <div style={{ display: "flex", alignItems: "flex-end", height: "100%", gap: HISTORY_COL_GAP }}>
                      {historyDayData.map((d) => {
                        const status = statusFor(d.actualTotal, effectivePlan.calories);
                        const barPct = d.hasEntries ? Math.max((d.actualTotal / historyMaxScale) * 100, 2) : 0;

                        return (
                          <div
                            key={d.date}
                            style={{
                              width: HISTORY_COL_WIDTH,
                              flexShrink: 0,
                              height: "100%",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "flex-end",
                              alignItems: "center",
                            }}
                          >
                            {d.hasEntries && (
                              <div
                                title={`${d.date}: ${d.actualTotal} kcal`}
                                style={{
                                  width: "70%",
                                  height: `${barPct}%`,
                                  background: STATUS_META[status].color,
                                  borderRadius: "3px 3px 0 0",
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: HISTORY_COL_GAP, marginTop: 6 }}>
                    {historyDayData.map((d) => (
                      <div
                        key={d.date}
                        style={{
                          width: HISTORY_COL_WIDTH,
                          flexShrink: 0,
                          textAlign: "center",
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 9.5,
                          color: INK_SOFT,
                        }}
                      >
                        {shortDayLabel(d.date)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "18px 0 22px" }}>
                {["green", "red", "yellow"].map((s) => (
                  <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_META[s].color, display: "inline-block" }} />
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: INK_SOFT }}>{STATUS_META[s].label}</span>
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 14, borderTop: `2px dashed ${INK_SOFT}`, display: "inline-block" }} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: INK_SOFT }}>Target</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, border: `1px dashed ${GRID}`, display: "inline-block" }} />
                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: INK_SOFT }}>Not logged</span>
                </div>
              </div>

              {historyDayData.map((d) => {
                const status = statusFor(d.actualTotal, effectivePlan.calories);

                return (
                  <div
                    key={d.date}
                    style={{ ...foodRowStyle, cursor: "pointer" }}
                    onClick={() => {
                      setComparisonDate(d.date);
                      setView("log");
                    }}
                  >
                    <div>
                      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{d.date}</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                        {d.actualTotal} / {effectivePlan.calories} kcal
                      </div>
                    </div>
                    {d.hasEntries ? (
                      <StatusBadge status={status} />
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: "#EEEEEC",
                          color: INK_SOFT,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 10.5,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                        }}
                      >
                        Not logged
                      </span>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {view === "chat" && (
        <div style={panelStyle}>
          <SectionTitle>Chat</SectionTitle>
          {myCoachLoading ? (
            <div style={{ fontSize: 12, color: INK_SOFT }}>Loading…</div>
          ) : !myCoachId ? (
            <div style={{ fontSize: 12.5, color: INK_SOFT }}>You don't have an active coach yet.</div>
          ) : (
            <ChatThread
              messages={chatMessages}
              loading={chatLoading}
              error={chatError}
              currentUserId={session && session.user.id}
              headerLabel={myCoachName || "Your coach"}
              input={chatInput}
              onInputChange={setChatInput}
              onSend={() => sendChatMessage(myCoachId)}
              sending={chatSending}
              sendError={chatSendError}
            />
          )}
        </div>
      )}
      </>
      )}

      {roleId === 2 && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ width: 200, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {[
              { id: "home", label: "Home", icon: Home },
              { id: "clients", label: "Clients", icon: Users },
              { id: "plans", label: "Plans", icon: ClipboardList },
              { id: "administration", label: "Administration", icon: Settings },
              { id: "chat", label: "Chat", icon: MessageSquare },
              { id: "notifications", label: "Notifications", icon: Bell },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 12px",
                  borderRadius: 4,
                  border: `1px solid ${view === t.id ? TEAL : GRID}`,
                  background: view === t.id ? TEAL_SOFT : PANEL,
                  color: view === t.id ? TEAL : INK_SOFT,
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <t.icon size={16} />
                {t.label}
                {t.id === "chat" && chatUnreadTotal > 0 && <UnreadBadge count={chatUnreadTotal} />}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {view === "home" && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h2 style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700, margin: 0 }}>
                    Home
                  </h2>
                  <button
                    onClick={() => setView("notifications")}
                    aria-label="Notifications"
                    style={{ ...iconButtonStyle, border: `1px solid ${GRID}`, borderRadius: 4, background: PANEL, padding: 8 }}
                  >
                    <Bell size={16} />
                  </button>
                </div>

                <div style={panelStyle}>
                  <SectionTitle>Your clients</SectionTitle>

                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 36, fontWeight: 600, color: INK, marginBottom: 12 }}>
                    {totalClientsCount}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: GREEN_SOFT,
                        color: GREEN,
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {activeClientsCount} Active
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: AMBER_SOFT,
                        color: AMBER,
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {invitedClientsCount} Invited
                    </span>
                  </div>

                  <button
                    onClick={() => setView("clients")}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: TEAL,
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    View all clients →
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={() => setView("clients")} style={primaryButtonStyle}>
                    + Add a client
                  </button>
                  <button onClick={() => setView("plans")} style={secondaryButtonStyle}>
                    Manage plans
                  </button>
                </div>
              </div>
            )}

            {view === "clients" && (
              <div>
                {createdClientCredentials && (
                  <div
                    style={{
                      position: "fixed",
                      inset: 0,
                      background: "rgba(27, 36, 48, 0.5)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 20,
                      zIndex: 1000,
                    }}
                  >
                    <div style={{ ...panelStyle, maxWidth: 420, width: "100%" }}>
                      <SectionTitle>Client created</SectionTitle>
                      <div style={{ fontSize: 13, marginBottom: 12 }}>
                        Client created — share these login details with them:
                      </div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 13,
                          background: PAPER,
                          border: `1px solid ${GRID}`,
                          borderRadius: 4,
                          padding: "10px 12px",
                          marginBottom: 10,
                          lineHeight: 1.8,
                        }}
                      >
                        <div>Email: {createdClientCredentials.email}</div>
                        <div>Temp password: {createdClientCredentials.tempPassword}</div>
                      </div>
                      <div style={{ fontSize: 11.5, color: INK_SOFT, marginBottom: 16 }}>
                        They'll need to change this password after logging in.
                      </div>
                      <button onClick={() => setCreatedClientCredentials(null)} style={primaryButtonStyle}>
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {addClientMessage && (
                  <div
                    style={{
                      marginBottom: 16,
                      padding: "10px 12px",
                      borderRadius: 4,
                      fontSize: 12.5,
                      background: addClientMessage.type === "success" ? GREEN_SOFT : RED_SOFT,
                      color: addClientMessage.type === "success" ? GREEN : RED,
                    }}
                  >
                    {addClientMessage.text}
                  </div>
                )}

                {clientsView === "grid" ? (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <SectionTitle>Clients</SectionTitle>
                      {clients.length > 0 && (
                        <button onClick={startAddClient} style={primaryButtonStyle}>
                          + Add client
                        </button>
                      )}
                    </div>

                    {clientsLoading ? (
                      <div style={{ fontSize: 12, color: INK_SOFT }}>Loading clients…</div>
                    ) : clientsError ? (
                      <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                        {clientsError}
                      </div>
                    ) : clients.length === 0 ? (
                      <div style={{ ...panelStyle, textAlign: "center" }}>
                        <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 16 }}>
                          There are no clients added yet
                        </div>
                        <button onClick={startAddClient} style={primaryButtonStyle}>
                          + Add client
                        </button>
                      </div>
                    ) : (
                      <>
                        <div style={{ ...panelStyle, padding: 0, overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={thStyle}>Client name</th>
                                <th style={thStyle}>Plan from</th>
                                <th style={thStyle}>Plan to</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {pagedClients.map((c) => (
                                <tr key={c.id} style={{ borderTop: `1px solid ${GRID}` }}>
                                  <td style={tdStyle}>{c.name}</td>
                                  <td style={tdStyle}>{c.dateFrom || "—"}</td>
                                  <td style={tdStyle}>{c.dateTo || "—"}</td>
                                  <td style={tdStyle}>
                                    <span
                                      style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        padding: "3px 8px",
                                        borderRadius: 4,
                                        background: c.active ? GREEN_SOFT : AMBER_SOFT,
                                        color: c.active ? GREEN : AMBER,
                                        fontFamily: "'Space Grotesk', sans-serif",
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        letterSpacing: 0.4,
                                      }}
                                    >
                                      {c.active ? "Active" : "Invited"}
                                    </span>
                                  </td>
                                  <td style={tdStyle}>
                                    <button
                                      onClick={() => {
                                        setSelectedClientId(c.id);
                                        setView("client-detail");
                                      }}
                                      style={secondaryButtonStyle}
                                    >
                                      View details
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                          <button
                            onClick={() => setClientsPage((p) => Math.max(1, p - 1))}
                            disabled={clampedClientsPage <= 1}
                            style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px", opacity: clampedClientsPage <= 1 ? 0.5 : 1, cursor: clampedClientsPage <= 1 ? "not-allowed" : "pointer" }}
                          >
                            Previous
                          </button>
                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                            Page {clampedClientsPage} of {totalClientsPages}
                          </span>
                          <button
                            onClick={() => setClientsPage((p) => Math.min(totalClientsPages, p + 1))}
                            disabled={clampedClientsPage >= totalClientsPages}
                            style={{ ...secondaryButtonStyle, fontSize: 11, padding: "5px 10px", opacity: clampedClientsPage >= totalClientsPages ? 0.5 : 1, cursor: clampedClientsPage >= totalClientsPages ? "not-allowed" : "pointer" }}
                          >
                            Next
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div style={panelStyle}>
                    <SectionTitle>{editingClientId ? "Edit client" : "Add a client"}</SectionTitle>

                    <label style={labelStyle}>Client name</label>
                    <input
                      type="text"
                      placeholder="Jane Doe"
                      value={addClientName}
                      onChange={(e) => setAddClientName(e.target.value)}
                      style={inputStyle}
                      disabled={addClientBusy}
                    />

                    <label style={labelStyle}>Email</label>
                    <input
                      type="email"
                      placeholder="client@example.com"
                      value={addClientEmail}
                      onChange={(e) => setAddClientEmail(e.target.value)}
                      style={inputStyle}
                      disabled={addClientBusy}
                    />

                    <label style={labelStyle}>Plan type (optional)</label>
                    <select
                      value={addClientPlanTypeId}
                      onChange={(e) => setAddClientPlanTypeId(e.target.value)}
                      style={inputStyle}
                      disabled={addClientBusy}
                    >
                      <option value="">No plan type</option>
                      {planTypes.map((pt) => (
                        <option key={pt.id} value={pt.id}>
                          {pt.name}
                        </option>
                      ))}
                    </select>

                    <div style={{ display: "flex", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>Plan from (optional)</label>
                        <input
                          type="date"
                          value={addClientDateFrom}
                          onChange={(e) => setAddClientDateFrom(e.target.value)}
                          style={inputStyle}
                          disabled={addClientBusy}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={labelStyle}>Plan to (optional)</label>
                        <input
                          type="date"
                          value={addClientDateTo}
                          onChange={(e) => setAddClientDateTo(e.target.value)}
                          style={inputStyle}
                          disabled={addClientBusy}
                        />
                      </div>
                    </div>

                    <label style={labelStyle}>Phone number (optional)</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select
                        value={addClientPhoneCountryCode}
                        onChange={(e) => setAddClientPhoneCountryCode(e.target.value)}
                        style={{ ...inputStyle, flex: "0 0 auto", width: 200 }}
                        disabled={addClientBusy}
                      >
                        {COUNTRY_DIAL_CODES.map((c) => (
                          <option key={c.label} value={c.code}>
                            {c.label} ({c.code})
                          </option>
                        ))}
                      </select>
                      <input
                        type="tel"
                        placeholder="1012345678"
                        value={addClientPhoneNumber}
                        onChange={(e) => setAddClientPhoneNumber(e.target.value.replace(/\D/g, ""))}
                        style={{ ...inputStyle, flex: 1 }}
                        disabled={addClientBusy}
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={editingClientId ? submitEditClient : submitAddClient}
                        style={primaryButtonStyle}
                        disabled={addClientBusy}
                      >
                        {addClientBusy ? "Saving…" : "Save"}
                      </button>
                      <button
                        onClick={() => {
                          setAddClientMessage(null);
                          if (editingClientId) {
                            setEditingClientId(null);
                            setView("client-detail");
                          } else {
                            setClientsView("grid");
                          }
                        }}
                        style={secondaryButtonStyle}
                        disabled={addClientBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === "plans" && (
              <div style={{ display: "grid", gap: 20 }}>
                {plansView === "list" ? (
                  <div style={panelStyle}>
                    <SectionTitle>Clients</SectionTitle>

                    {clientsLoading ? (
                      <div style={{ fontSize: 12, color: INK_SOFT }}>Loading clients…</div>
                    ) : clientsError ? (
                      <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                        {clientsError}
                      </div>
                    ) : activePlanClients.length === 0 ? (
                      <div style={{ fontSize: 12, color: INK_SOFT }}>You don't have any active clients yet.</div>
                    ) : (
                      <div style={{ padding: 0, overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr>
                              <th style={thStyle}>Client name</th>
                              <th style={thStyle}>Plan status</th>
                              <th style={thStyle}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {activePlanClients.map((c) => {
                              const mealsConfigured = clientPlanSummaries[c.id] || 0;
                              const hasPlan = mealsConfigured > 0;
                              return (
                                <tr
                                  key={c.id}
                                  style={{
                                    borderTop: `1px solid ${GRID}`,
                                    cursor: clientPlanSummariesLoading ? "default" : "pointer",
                                    opacity: clientPlanSummariesLoading ? 0.6 : 1,
                                  }}
                                  onClick={() => !clientPlanSummariesLoading && openClientPlanDetails(c.id)}
                                >
                                  <td style={tdStyle}>{c.name}</td>
                                  <td style={tdStyle}>
                                    <PlanStatusBadge status={clientPlanStatuses[c.id]} />
                                  </td>
                                  <td style={tdStyle}>
                                    {hasPlan ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openClientPlanDetails(c.id); }}
                                        style={secondaryButtonStyle}
                                        disabled={clientPlanSummariesLoading}
                                      >
                                        View details
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); editClientPlan(c.id); }}
                                        style={{ ...secondaryButtonStyle, background: TEAL, border: `1px solid ${TEAL}`, color: "#FFFFFF" }}
                                        disabled={clientPlanSummariesLoading}
                                      >
                                        Create plan
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {clientPlanSummariesLoading && (
                          <div style={{ fontSize: 12, color: INK_SOFT, padding: "8px 10px" }}>Loading plan status…</div>
                        )}
                      </div>
                    )}
                  </div>
                ) : plansView === "builder" ? (
                  <div style={panelStyle}>
                    <button
                      onClick={backToClientsList}
                      style={{ ...secondaryButtonStyle, width: "auto", marginBottom: 14 }}
                    >
                      ← Back to clients
                    </button>

                    <SectionTitle>
                      {(clients.find((c) => c.id === planBuilderClientId) || {}).name || "Client"}'s plan
                    </SectionTitle>

                    {clientPlanLoading ? (
                      <div style={{ fontSize: 12, color: INK_SOFT }}>Loading plan…</div>
                    ) : clientPlanError ? (
                      <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                        {clientPlanError}
                      </div>
                    ) : (
                      <>
                        <label style={labelStyle}>Plan name</label>
                        <input
                          type="text"
                          placeholder="e.g. Cutting phase — September"
                          value={clientPlanName}
                          onChange={(e) => setClientPlanName(e.target.value)}
                          style={{ ...inputStyle, width: "50%" }}
                        />

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
                          <div>
                            <label style={labelStyle}>Date from</label>
                            <input
                              type="date"
                              value={clientPlanDateFrom}
                              onChange={(e) => setClientPlanDateFrom(e.target.value)}
                              style={{ ...inputStyle, marginBottom: 0 }}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Date to</label>
                            <input
                              type="date"
                              value={clientPlanDateTo}
                              onChange={(e) => setClientPlanDateTo(e.target.value)}
                              style={{ ...inputStyle, marginBottom: 0 }}
                            />
                          </div>
                        </div>
                        {clientPlanDateFrom && clientPlanDateTo && clientPlanDateTo < clientPlanDateFrom ? (
                          <div style={{ marginBottom: 16, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                            "Date to" can't be earlier than "Date from". Please enter a valid date range.
                          </div>
                        ) : (
                          <div style={{ marginBottom: 16 }} />
                        )}

                        <div style={{ marginBottom: 14 }}>
                          <label style={labelStyle}>Food name</label>
                          <select
                            value={newClientPlanFood.foodKey}
                            onChange={(e) => {
                              const key = e.target.value;
                              setNewClientPlanFood({ ...newClientPlanFood, foodKey: key, grams: "", calories: 0 });
                            }}
                            style={inputStyle}
                            disabled={personalFoods.length === 0}
                          >
                            <option value="">{personalFoods.length === 0 ? "No foods available yet" : "Select a food…"}</option>
                            {personalFoods.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>

                          <label style={labelStyle}>Grams</label>
                          <input
                            type="number"
                            placeholder="Grams"
                            value={newClientPlanFood.grams}
                            onChange={(e) => {
                              const grams = e.target.value;
                              const match = personalFoods.find((f) => f.id === newClientPlanFood.foodKey);
                              const numGrams = Number(grams) || 0;
                              const calories = match && match.calPer100g ? Math.round((match.calPer100g * numGrams) / 100) : 0;
                              setNewClientPlanFood({ ...newClientPlanFood, grams, calories });
                            }}
                            style={inputStyle}
                          />

                          <label style={labelStyle}>Calories</label>
                          <input
                            type="number"
                            placeholder="Calories"
                            value={newClientPlanFood.calories}
                            readOnly
                            style={{ ...inputStyle, background: PAPER, color: INK_SOFT, cursor: "not-allowed" }}
                          />

                          <label style={labelStyle}>Meal</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                            {MEALS.map((m) => (
                              <button
                                key={m}
                                onClick={() => setNewClientPlanFood({ ...newClientPlanFood, meal: m })}
                                style={{ ...toggleStyle(newClientPlanFood.meal === m), fontSize: 11, padding: "6px 10px" }}
                              >
                                {m}
                              </button>
                            ))}
                          </div>

                          <label style={labelStyle}>Course</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                            {COURSES.map((c) => (
                              <button
                                key={c}
                                onClick={() => setNewClientPlanFood({ ...newClientPlanFood, course: c })}
                                style={{ ...toggleStyle(newClientPlanFood.course === c), fontSize: 11, padding: "6px 10px" }}
                              >
                                {c}
                              </button>
                            ))}
                          </div>

                          <button
                            onClick={addClientPlanFood}
                            style={{ ...secondaryButtonStyle, width: "auto", background: GREEN, border: `1px solid ${GREEN}`, color: "#FFFFFF" }}
                          >
                            <Plus size={14} strokeWidth={2.5} /> Add food
                          </button>

                          {clientPlanAddError && (
                            <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                              {clientPlanAddError}
                            </div>
                          )}
                        </div>

                        <div style={{ maxHeight: 340, overflowY: "auto" }}>
                          {clientPlanFoods.length === 0 && <div style={{ fontSize: 12, color: INK_SOFT }}>No foods added to this plan yet.</div>}
                          {MEALS.map((mealName) => {
                            const mealFoods = clientPlanFoods.filter((f) => f.meal === mealName);
                            if (mealFoods.length === 0) return null;

                            const mealTotalCal = mealFoods.reduce((sum, f) => sum + f.calories, 0);

                            return (
                              <div key={mealName} style={{ marginBottom: 16 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    padding: "4px 8px",
                                    background: TEAL_SOFT,
                                    borderRadius: 4,
                                    marginBottom: 4,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontFamily: "'Space Grotesk', sans-serif",
                                      fontSize: 14,
                                      fontWeight: 700,
                                      color: TEAL,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.5,
                                    }}
                                  >
                                    {mealName}
                                  </span>
                                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL }}>
                                    {mealTotalCal} kcal total
                                  </span>
                                </div>
                                {COURSES.map((courseName) => {
                                  const courseFoods = mealFoods.filter((f) => (f.course || "Main") === courseName);
                                  if (courseFoods.length === 0) return null;

                                  return (
                                    <div key={courseName} style={{ marginBottom: 8 }}>
                                      <div
                                        style={{
                                          fontFamily: "'Space Grotesk', sans-serif",
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: GREEN,
                                          background: GREEN_SOFT,
                                          textTransform: "uppercase",
                                          letterSpacing: 0.5,
                                          padding: "2px 8px",
                                          borderRadius: 4,
                                          display: "inline-block",
                                        }}
                                      >
                                        {courseName}
                                      </div>
                                      {courseFoods.map((f) => (
                                        <div key={f.id} style={foodRowStyle}>
                                          <div>
                                            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                                              {f.grams}g · {f.calories} kcal
                                            </div>
                                          </div>
                                          <button onClick={() => removeClientPlanFood(f.id)} style={iconButtonStyle} aria-label="Remove food">
                                            <Trash2 size={14} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 14, borderTop: `1px solid ${GRID}` }}>
                          <button
                            onClick={saveClientPlan}
                            style={primaryButtonStyle}
                            disabled={
                              clientPlanSaveBusy ||
                              (clientPlanDateFrom && clientPlanDateTo && clientPlanDateTo < clientPlanDateFrom)
                            }
                          >
                            {clientPlanSaveBusy ? "Saving…" : "Save"}
                          </button>
                          <button
                            onClick={sendClientPlan}
                            style={{ ...secondaryButtonStyle, width: "auto", background: TEAL, border: `1px solid ${TEAL}`, color: "#FFFFFF" }}
                            disabled={clientPlanStatus !== "draft" || clientPlanSendBusy}
                          >
                            {clientPlanSendBusy ? "Sending…" : "Send"}
                          </button>
                          {clientPlanStatus && (
                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
                              Status: {clientPlanStatus}
                            </span>
                          )}
                        </div>

                        {clientPlanSaveError && (
                          <div style={{ marginTop: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                            {clientPlanSaveError}
                          </div>
                        )}
                        {clientPlanSendError && (
                          <div style={{ marginTop: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                            {clientPlanSendError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : plansView === "details" ? (
                  <div style={panelStyle}>
                    <button
                      onClick={backToClientsList}
                      style={{ ...secondaryButtonStyle, width: "auto", marginBottom: 14 }}
                    >
                      ← Back to clients
                    </button>

                    <SectionTitle>
                      {(clients.find((c) => c.id === planDetailsClientId) || {}).name || "Client"}'s plan
                    </SectionTitle>

                    {planDetailsLoading ? (
                      <div style={{ fontSize: 12, color: INK_SOFT }}>Loading plan…</div>
                    ) : planDetailsError ? (
                      <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                        {planDetailsError}
                      </div>
                    ) : (
                      <>
                        <div style={{ marginBottom: 16 }}>
                          <PlanStatusBadge status={planDetailsStatus} />
                        </div>

                        <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 18 }}>
                          {planDetailsFoods.length === 0 && (
                            <div style={{ fontSize: 12, color: INK_SOFT }}>No plan yet.</div>
                          )}
                          {MEALS.map((mealName) => {
                            const mealFoods = planDetailsFoods.filter((f) => f.meal === mealName);
                            if (mealFoods.length === 0) return null;

                            const mealTotalCal = mealFoods.reduce((sum, f) => sum + f.calories, 0);

                            return (
                              <div key={mealName} style={{ marginBottom: 16 }}>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "baseline",
                                    padding: "4px 8px",
                                    background: TEAL_SOFT,
                                    borderRadius: 4,
                                    marginBottom: 4,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontFamily: "'Space Grotesk', sans-serif",
                                      fontSize: 14,
                                      fontWeight: 700,
                                      color: TEAL,
                                      textTransform: "uppercase",
                                      letterSpacing: 0.5,
                                    }}
                                  >
                                    {mealName}
                                  </span>
                                  <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: TEAL }}>
                                    {mealTotalCal} kcal total
                                  </span>
                                </div>
                                {COURSES.map((courseName) => {
                                  const courseFoods = mealFoods.filter((f) => (f.course || "Main") === courseName);
                                  if (courseFoods.length === 0) return null;

                                  return (
                                    <div key={courseName} style={{ marginBottom: 8 }}>
                                      <div
                                        style={{
                                          fontFamily: "'Space Grotesk', sans-serif",
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: GREEN,
                                          background: GREEN_SOFT,
                                          textTransform: "uppercase",
                                          letterSpacing: 0.5,
                                          padding: "2px 8px",
                                          borderRadius: 4,
                                          display: "inline-block",
                                        }}
                                      >
                                        {courseName}
                                      </div>
                                      {courseFoods.map((f) => (
                                        <div key={f.id} style={foodRowStyle}>
                                          <div>
                                            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                                            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                                              {f.grams}g · {f.calories} kcal
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>

                        {(() => {
                          const noPlanYet = planDetailsFoods.length === 0;
                          const deactivateDisabled = noPlanYet || planDetailsStatus === "inactive";
                          const editDisabled = noPlanYet;
                          const removeDisabled = noPlanYet;

                          return (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                              <button
                                onClick={() => deactivateClientPlan(planDetailsClientId)}
                                style={planActionButtonStyle(
                                  { ...secondaryButtonStyle, border: `1px solid ${AMBER}`, color: AMBER },
                                  deactivateDisabled
                                )}
                                disabled={planDetailsDeactivateBusy || deactivateDisabled}
                              >
                                {planDetailsDeactivateBusy ? "Deactivating…" : "Deactivate"}
                              </button>
                              <button
                                onClick={() => editClientPlan(planDetailsClientId)}
                                style={planActionButtonStyle(
                                  { ...secondaryButtonStyle, background: TEAL, border: `1px solid ${TEAL}`, color: "#FFFFFF" },
                                  editDisabled
                                )}
                                disabled={editDisabled}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() =>
                                  removeClientPlanEntirely(
                                    planDetailsClientId,
                                    (clients.find((c) => c.id === planDetailsClientId) || {}).name
                                  )
                                }
                                style={planActionButtonStyle(
                                  { ...secondaryButtonStyle, border: `1px solid ${RED}`, color: RED },
                                  removeDisabled
                                )}
                                disabled={planDetailsRemoveBusy || removeDisabled}
                              >
                                {planDetailsRemoveBusy ? "Removing…" : "Remove"}
                              </button>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {view === "administration" && (
              <div>
                <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${GRID}`, paddingBottom: 12 }}>
                  {[{ id: "planTypes", label: "Plan types" }, { id: "foodList", label: "Food list" }].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setAdminTab(t.id)}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 4,
                        border: `1px solid ${adminTab === t.id ? TEAL : GRID}`,
                        background: adminTab === t.id ? TEAL_SOFT : PANEL,
                        color: adminTab === t.id ? TEAL : INK_SOFT,
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {adminTab === "planTypes" && (
                  <div style={{ display: "grid", gap: 20 }}>
                    <div style={panelStyle}>
                      <SectionTitle>Plan types</SectionTitle>

                      {planTypesLoading ? (
                        <div style={{ fontSize: 12, color: INK_SOFT }}>Loading plan types…</div>
                      ) : planTypesError ? (
                        <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {planTypesError}
                        </div>
                      ) : planTypes.length === 0 ? (
                        <div style={{ fontSize: 12, color: INK_SOFT }}>You haven't defined any plan types yet.</div>
                      ) : (
                        <div>
                          {planTypes.map((pt) => (
                            <div key={pt.id} style={foodRowStyle}>
                              <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>
                                {pt.name}
                              </span>
                              <button onClick={() => deletePlanType(pt.id)} style={iconButtonStyle} aria-label={`Delete ${pt.name}`}>
                                <Trash2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={panelStyle}>
                      <SectionTitle>Add plan type</SectionTitle>

                      <label style={labelStyle}>Plan type name</label>
                      <input
                        type="text"
                        placeholder="e.g. Fat loss - 12 weeks"
                        value={newPlanTypeName}
                        onChange={(e) => setNewPlanTypeName(e.target.value)}
                        style={inputStyle}
                        disabled={addPlanTypeBusy}
                      />

                      <button onClick={submitAddPlanType} style={primaryButtonStyle} disabled={addPlanTypeBusy}>
                        {addPlanTypeBusy ? "Adding…" : "Add plan type"}
                      </button>

                      {addPlanTypeError && (
                        <div style={{ marginTop: 12, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {addPlanTypeError}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {adminTab === "foodList" && (
                  <div style={{ display: "grid", gap: 20 }}>
                    <div style={panelStyle}>
                      <SectionTitle>Global food list</SectionTitle>
                      {globalFoodsError && (
                        <div style={{ marginBottom: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {globalFoodsError}
                        </div>
                      )}
                      {transferError && (
                        <div style={{ marginBottom: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {transferError}
                        </div>
                      )}
                      <div style={{ maxHeight: 340, overflowY: "auto" }}>
                        {globalFoods.length === 0 && !globalFoodsLoading && (
                          <div style={{ fontSize: 12, color: INK_SOFT }}>No foods in the global list yet.</div>
                        )}
                        {globalFoods.map((f) => (
                          <label key={f.id} style={{ ...foodRowStyle, justifyContent: "flex-start", gap: 10, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={selectedGlobalFoodIds.includes(f.id)}
                              onChange={() => toggleGlobalFoodSelection(f.id)}
                              style={{ width: 16, height: 16, cursor: "pointer", flexShrink: 0 }}
                            />
                            <div>
                              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                                {f.calPer100g ? `${f.calPer100g} kcal / 100g` : "No calories set"}
                              </div>
                            </div>
                          </label>
                        ))}
                        {globalFoodsLoading && (
                          <div style={{ fontSize: 12, color: INK_SOFT, paddingTop: 8 }}>Loading global food list…</div>
                        )}
                      </div>
                      <button
                        onClick={transferSelectedGlobalFoods}
                        style={{ ...secondaryButtonStyle, width: "auto", marginTop: 14, background: TEAL, border: `1px solid ${TEAL}`, color: "#FFFFFF" }}
                        disabled={selectedGlobalFoodIds.length === 0 || transferBusy}
                      >
                        {transferBusy ? "Transferring…" : `Transfer selected${selectedGlobalFoodIds.length > 0 ? ` (${selectedGlobalFoodIds.length})` : ""}`}
                      </button>
                    </div>

                    <div style={panelStyle}>
                      <SectionTitle>Add a food</SectionTitle>

                      <label style={labelStyle}>Food name</label>
                      <input
                        placeholder="Food name"
                        value={newPersonalFood.name}
                        onChange={(e) => setNewPersonalFood({ ...newPersonalFood, name: e.target.value })}
                        style={inputStyle}
                      />
                      <label style={labelStyle}>Calories per 100g (optional)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Calories per 100g"
                        value={newPersonalFood.calPer100g}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, "");
                          const firstDot = raw.indexOf(".");
                          const sanitized =
                            firstDot === -1 ? raw : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
                          setNewPersonalFood({ ...newPersonalFood, calPer100g: sanitized });
                        }}
                        style={inputStyle}
                      />
                      <button onClick={addPersonalFood} style={{ ...secondaryButtonStyle, width: "auto", background: GREEN, border: `1px solid ${GREEN}`, color: "#FFFFFF" }}>
                        <Plus size={14} strokeWidth={2.5} /> Add to list
                      </button>
                      {personalFoodError && (
                        <div style={{ marginTop: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {personalFoodError}
                        </div>
                      )}
                    </div>

                    <div style={panelStyle}>
                      <SectionTitle>Your own food list</SectionTitle>
                      {editFoodError && (
                        <div style={{ marginBottom: 10, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                          {editFoodError}
                        </div>
                      )}
                      <div style={{ maxHeight: 340, overflowY: "auto" }}>
                        {personalFoods.length === 0 && (
                          <div style={{ fontSize: 12, color: INK_SOFT }}>No foods in your list yet.</div>
                        )}
                        {personalFoods.map((f) =>
                          editingFoodId === f.id ? (
                            <div key={f.id} style={{ ...foodRowStyle, gap: 8 }}>
                              <div style={{ display: "flex", gap: 8, flex: 1 }}>
                                <input
                                  placeholder="Food name"
                                  value={editFoodName}
                                  onChange={(e) => setEditFoodName(e.target.value)}
                                  style={{ ...smallInputStyle, flex: 1 }}
                                />
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Cal / 100g"
                                  value={editFoodCalPer100g}
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/[^0-9.]/g, "");
                                    const firstDot = raw.indexOf(".");
                                    const sanitized =
                                      firstDot === -1 ? raw : raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
                                    setEditFoodCalPer100g(sanitized);
                                  }}
                                  style={{ ...smallInputStyle, width: 100 }}
                                />
                              </div>
                              <button onClick={saveEditFood} style={iconButtonStyle} aria-label="Save changes" disabled={editFoodBusy}>
                                <Check size={15} />
                              </button>
                              <button onClick={cancelEditFood} style={iconButtonStyle} aria-label="Cancel editing" disabled={editFoodBusy}>
                                <X size={15} />
                              </button>
                            </div>
                          ) : (
                            <div key={f.id} style={foodRowStyle}>
                              <div>
                                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{f.name}</div>
                                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                                  {f.calPer100g ? `${f.calPer100g} kcal / 100g` : "No calories set"}
                                </div>
                              </div>
                              <div style={{ display: "flex", gap: 4 }}>
                                <button onClick={() => startEditFood(f)} style={iconButtonStyle} aria-label="Edit food">
                                  <Pencil size={14} />
                                </button>
                                <button onClick={() => removePersonalFood(f.id)} style={iconButtonStyle} aria-label="Remove food">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === "chat" && (
              <div style={panelStyle}>
                <SectionTitle>Chat</SectionTitle>
                {clientsLoading ? (
                  <div style={{ fontSize: 12, color: INK_SOFT }}>Loading clients…</div>
                ) : clientsError ? (
                  <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
                    {clientsError}
                  </div>
                ) : activePlanClients.length === 0 ? (
                  <div style={{ fontSize: 12, color: INK_SOFT }}>You don't have any active clients yet.</div>
                ) : (
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 220,
                        flexShrink: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        maxHeight: 480,
                        overflowY: "auto",
                      }}
                    >
                      {activePlanClients.map((c) => {
                        const unread = chatUnreadByClient[c.id] || 0;
                        const selected = chatSelectedClientId === c.id;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setChatSelectedClientId(c.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "9px 12px",
                              borderRadius: 4,
                              border: `1px solid ${selected ? TEAL : GRID}`,
                              background: selected ? TEAL_SOFT : PANEL,
                              color: selected ? TEAL : INK,
                              fontFamily: "'Space Grotesk', sans-serif",
                              fontSize: 13,
                              fontWeight: 600,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.name}
                            </span>
                            {unread > 0 && <UnreadBadge count={unread} />}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {chatSelectedClientId ? (
                        <ChatThread
                          messages={chatMessages}
                          loading={chatLoading}
                          error={chatError}
                          currentUserId={session && session.user.id}
                          headerLabel={(clients.find((c) => c.id === chatSelectedClientId) || {}).name}
                          input={chatInput}
                          onInputChange={setChatInput}
                          onSend={() => sendChatMessage(chatSelectedClientId)}
                          sending={chatSending}
                          sendError={chatSendError}
                        />
                      ) : (
                        <div style={{ fontSize: 12, color: INK_SOFT }}>Select a client to view your conversation.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === "notifications" && (
              <div style={panelStyle}>
                <SectionTitle>Notifications</SectionTitle>
                <div style={{ fontSize: 12.5, color: INK_SOFT }}>Notifications screen — coming soon.</div>
              </div>
            )}

            {view === "client-detail" && (
              <div style={{ display: "grid", gap: 16 }}>
                {clientDetailFlash && (
                  <div style={{ padding: "10px 12px", borderRadius: 4, fontSize: 12.5, background: GREEN_SOFT, color: GREEN }}>
                    {clientDetailFlash}
                  </div>
                )}

                {clientDetailError && (
                  <div style={{ padding: "10px 12px", borderRadius: 4, fontSize: 12.5, background: RED_SOFT, color: RED }}>
                    {clientDetailError}
                  </div>
                )}

                {clientDetailLoading ? (
                  <div style={{ fontSize: 12, color: INK_SOFT }}>Loading client…</div>
                ) : clientDetail ? (
                  <div style={panelStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                      <SectionTitle>{clientDetail.name}</SectionTitle>
                      {(() => {
                        const meta = clientStatusMeta(clientDetail);
                        return (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "3px 10px",
                              borderRadius: 4,
                              background: meta.soft,
                              color: meta.color,
                              fontFamily: "'Space Grotesk', sans-serif",
                              fontSize: 10.5,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: 0.4,
                            }}
                          >
                            {meta.label}
                          </span>
                        );
                      })()}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
                      <div>
                        <div style={labelStyle}>Email</div>
                        <div style={{ fontSize: 13 }}>{clientDetail.email || "—"}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Phone</div>
                        <div style={{ fontSize: 13 }}>{clientDetail.phone || "—"}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Plan type</div>
                        <div style={{ fontSize: 13 }}>{clientDetail.planTypeName || "—"}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Plan from</div>
                        <div style={{ fontSize: 13 }}>{clientDetail.dateFrom || "—"}</div>
                      </div>
                      <div>
                        <div style={labelStyle}>Plan to</div>
                        <div style={{ fontSize: 13 }}>{clientDetail.dateTo || "—"}</div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <button onClick={() => startEditClient(clientDetail)} style={secondaryButtonStyle} disabled={clientDetailBusy}>
                        Edit
                      </button>
                      <button
                        onClick={() => removeClient(clientDetail.id, clientDetail.name)}
                        style={{ ...secondaryButtonStyle, border: `1px solid ${RED}`, color: RED }}
                        disabled={clientDetailBusy}
                      >
                        Remove
                      </button>
                      <button onClick={() => toggleClientStatus(clientDetail)} style={secondaryButtonStyle} disabled={clientDetailBusy}>
                        {clientDetail.coachStatus === "inactive" ? "Reactivate" : "Deactivate"}
                      </button>
                    </div>
                  </div>
                ) : (
                  !clientDetailError && <div style={{ fontSize: 12, color: INK_SOFT }}>Client not found.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600, marginBottom: 14, color: INK_SOFT, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {children}
    </div>
  );
}

function formatChatTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";

  const isToday = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return isToday ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function ChatThread({ messages, loading, error, currentUserId, headerLabel, input, onInputChange, onSend, sending, sendError }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(e) {
    e.preventDefault();
    onSend();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
      {headerLabel && (
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 14, fontWeight: 700, marginBottom: 10, color: INK }}>
          {headerLabel}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          border: `1px solid ${GRID}`,
          borderRadius: 6,
          padding: 12,
          background: PAPER,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginBottom: 10,
        }}
      >
        {loading ? (
          <div style={{ fontSize: 12, color: INK_SOFT }}>Loading messages…</div>
        ) : error ? (
          <div style={{ padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>{error}</div>
        ) : messages.length === 0 ? (
          <div style={{ fontSize: 12, color: INK_SOFT }}>No messages yet. Say hello!</div>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_id === currentUserId;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isMine ? "flex-end" : "flex-start" }}>
                <div
                  style={{
                    maxWidth: "70%",
                    padding: "8px 12px",
                    borderRadius: 10,
                    background: isMine ? TEAL : PANEL,
                    color: isMine ? "#FFFFFF" : INK,
                    border: isMine ? "none" : `1px solid ${GRID}`,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 13,
                  }}
                >
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                  <div
                    style={{
                      marginTop: 4,
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: 9.5,
                      opacity: 0.75,
                      textAlign: "right",
                    }}
                  >
                    {formatChatTime(m.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {sendError && (
        <div style={{ marginBottom: 8, padding: "8px 10px", background: RED_SOFT, color: RED, borderRadius: 4, fontSize: 12 }}>
          {sendError}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          style={{ ...inputStyle, flex: 1, marginBottom: 0 }}
        />
        <button type="submit" style={{ ...primaryButtonStyle, width: "auto" }} disabled={sending || !input.trim()}>
          <Send size={14} strokeWidth={2.5} /> {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

const panelStyle = {
  background: PANEL,
  border: `1px solid ${GRID}`,
  borderRadius: 6,
  padding: "1.25rem",
  alignSelf: "start",
};

const labelStyle = {
  display: "block",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10,
  color: INK_SOFT,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 5,
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  marginBottom: 14,
  border: `1px solid ${GRID}`,
  borderRadius: 4,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 13,
  color: INK,
  background: PAPER,
};

const smallInputStyle = {
  ...inputStyle,
  marginBottom: 0,
  padding: "7px 8px",
  fontSize: 12,
};

function toggleStyle(active) {
  return {
    padding: "7px 10px",
    borderRadius: 4,
    border: `1px solid ${active ? TEAL : GRID}`,
    background: active ? TEAL_SOFT : PANEL,
    color: active ? TEAL : INK_SOFT,
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };
}

const primaryButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "9px 14px",
  borderRadius: 4,
  border: `1px solid ${TEAL}`,
  background: TEAL,
  color: "#FFFFFF",
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 12px",
  borderRadius: 4,
  border: `1px solid ${GRID}`,
  background: PANEL,
  color: INK,
  fontFamily: "'Space Grotesk', sans-serif",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const iconButtonStyle = {
  border: "none",
  background: "transparent",
  color: INK_SOFT,
  cursor: "pointer",
  padding: 4,
};

const disabledActionButtonStyle = {
  background: "#ECEDE7",
  border: `1px solid ${GRID}`,
  color: "#9BA096",
  cursor: "not-allowed",
  opacity: 0.7,
};

function planActionButtonStyle(baseStyle, isDisabled) {
  return isDisabled ? { ...baseStyle, ...disabledActionButtonStyle } : baseStyle;
}

const foodRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: `1px solid ${GRID}`,
};

const thStyle = {
  textAlign: "left",
  padding: "8px 10px",
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 10.5,
  color: TEAL,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const tdStyle = {
  padding: "7px 10px",
  fontFamily: "'IBM Plex Mono', monospace",
  color: INK,
};
