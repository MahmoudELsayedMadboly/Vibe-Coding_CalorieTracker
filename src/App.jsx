import { useState, useEffect, useMemo } from "react";
import { Plus, Trash2, Check, AlertTriangle, TrendingDown, Save } from "lucide-react";
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

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function sevenDaysAgoStr() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
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

  const [profile, setProfile] = useState({ sex: "male", age: 30, weightKg: 75, heightCm: 175, activity: "moderate" });
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
  const [entryError, setEntryError] = useState(null);
  const [savedPlanOverride, setSavedPlanOverride] = useState(null);
  const [planDateFrom, setPlanDateFrom] = useState("");
  const [planDateTo, setPlanDateTo] = useState("");
  const [tableFilterType, setTableFilterType] = useState("");
  const [tableFilterDateFrom, setTableFilterDateFrom] = useState("");
  const [tableFilterDateTo, setTableFilterDateTo] = useState("");
  const [tableFilterMeal, setTableFilterMeal] = useState("");
  const [tableFilterFood, setTableFilterFood] = useState("");
  const [tablePage, setTablePage] = useState(1);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

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

        const [personalFoodsRes, planFoodsRes, logsRes] = await Promise.all([
          supabase.from("food_list").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
          supabase.from("plan_foods").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
          supabase.from("meal_logs").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
        ]);

        if (personalFoodsRes.error) throw personalFoodsRes.error;
        if (planFoodsRes.error) throw planFoodsRes.error;
        if (logsRes.error) throw logsRes.error;

        const p = profileRow;

        if (p) {
          setProfile({
            sex: p.sex || "male",
            age: p.age ?? 30,
            weightKg: p.weight_kg ?? 75,
            heightCm: p.height_cm ?? 175,
            activity: p.activity || "moderate",
          });
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

        setPlanDateFrom((planFoodsRows[0] && planFoodsRows[0].plan_date_from) || "");
        setPlanDateTo((planFoodsRows[0] && planFoodsRows[0].plan_date_to) || "");

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
    const ok = await persist({ profile, goal, planOverride, foods });

    if (ok) {
      setSavedPlanOverride(planOverride);
      setSetupSavedFlash(true);
      setTimeout(() => setSetupSavedFlash(false), 2500);
      if (session && session.user) clearDraft(session.user.id);
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
    };

    const next = [...foods, food];
    const ok = await persist({ foods: next });

    if (ok) {
      setFoods(next);
      setNewFood({ personalFoodId: "", grams: "", calories: "", meal: newFood.meal, course: newFood.course });
    } else {
      setAddFoodError("Couldn't save this food. Please try again.");
    }
  }

  async function removeFood(id) {
    const next = foods.filter((f) => f.id !== id);
    const ok = await persist({ foods: next });

    if (ok) {
      setFoods(next);
    } else {
      setAddFoodError("Couldn't remove this food. Please try again.");
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
      const food = foods.find((f) => f.id === entryFoodId);
      if (!food) return;

      const scale = food.grams > 0 ? grams / food.grams : 0;

      entry = {
        id: crypto.randomUUID(),
        name: food.name,
        meal: logMeal,
        grams,
        calories: Math.round(food.calories * scale),
        protein: Math.round(food.protein * scale),
        carbs: Math.round(food.carbs * scale),
        fat: Math.round(food.fat * scale),
      };
    } else {
      entry = {
        id: crypto.randomUUID(),
        name: customName,
        meal: logMeal,
        grams,
        calories: 0,
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

  const historyDates = Object.keys(logs).sort().reverse().slice(0, 14);

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

      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {[
          { id: "setup", label: "Configuration" },
          { id: "log", label: "Daily log" },
          { id: "history", label: "History" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            style={{
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
          </button>
        ))}
      </div>

      {view === "setup" && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: `1px solid ${GRID}`, paddingBottom: 12 }}>
            {[
              { id: "profile", label: "Profile & program" },
              { id: "foodListConfig", label: "Configure your food list" },
              { id: "foodMaterials", label: "Create a plan" },
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

              <label style={labelStyle}>Age</label>
              <input type="number" value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })} style={inputStyle} />

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

              <button onClick={saveSetup} style={{ ...primaryButtonStyle, marginTop: 8, width: "100%", background: setupSavedFlash ? GREEN : TEAL, border: `1px solid ${setupSavedFlash ? GREEN : TEAL}` }}>
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

          {configTab === "foodMaterials" && (
            <div style={panelStyle}>
              <SectionTitle>Create a plan</SectionTitle>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                Define your plan
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

                <button onClick={addFood} style={{ ...secondaryButtonStyle, width: "100%" }}>
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
              <button onClick={addPersonalFood} style={{ ...secondaryButtonStyle, width: "100%" }}>
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
        </div>
      )}

      {view === "log" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={panelStyle}>
            <SectionTitle>Add meal</SectionTitle>

            <label style={labelStyle}>Date</label>
            <input
              type="date"
              value={selectedDate}
              min={sevenDaysAgoStr()}
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
              disabled={foods.length === 0}
            >
              <option value="">{foods.length === 0 ? "No foods configured yet" : "Select a food…"}</option>
              {foods.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
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

            <button onClick={addEntry} style={{ ...secondaryButtonStyle, width: "100%" }}>
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
      )}

      {view === "history" && (
        <div style={panelStyle}>
          <SectionTitle>Last 14 logged days</SectionTitle>
          {historyDates.length === 0 && <div style={{ fontSize: 12, color: INK_SOFT }}>No history yet — log a day to see it here.</div>}
          {historyDates.map((date) => {
            const entries = logs[date] || [];
            const totals = entries.reduce(
              (acc, e) => ({
                calories: acc.calories + e.calories,
                protein: acc.protein + e.protein,
                carbs: acc.carbs + e.carbs,
                fat: acc.fat + e.fat,
              }),
              { calories: 0, protein: 0, carbs: 0, fat: 0 }
            );
            const calStatus = statusFor(totals.calories, effectivePlan.calories);

            return (
              <div key={date} style={{ ...foodRowStyle, cursor: "pointer" }} onClick={() => { setSelectedDate(date); setView("log"); }}>
                <div>
                  <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 600 }}>{date}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: INK_SOFT }}>
                    {totals.calories} kcal · P{totals.protein} C{totals.carbs} F{totals.fat}
                  </div>
                </div>
                <StatusBadge status={calStatus} />
              </div>
            );
          })}
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
