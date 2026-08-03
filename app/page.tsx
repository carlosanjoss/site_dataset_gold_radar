"use client";

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Copy,
  Database,
  Edit3,
  Eye,
  FileText,
  Gauge,
  GitCompareArrows,
  History,
  KeyRound,
  Layers3,
  Maximize2,
  Minimize2,
  LogOut,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Target,
  Table2,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NLI_LAYER3_QUESTIONS,
  NLI_LAYER4_DIMENSIONS,
  type NliLayer3Level,
} from "@/lib/nli";

type Reviewer = {
  reviewerId: number;
  displayName: string;
  reviewerCode: string;
  username: string;
  role: "admin" | "reviewer";
  mustChangePassword: boolean;
};

type ManagedUser = {
  reviewerId: number;
  displayName: string;
  username: string;
  role: "admin" | "reviewer";
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  reviewedCount: number;
  doubleReviewEnabled: boolean;
};

type AdminMetrics = {
  generatedAt: string;
  inference: {
    model: string;
    promptVersion: string;
    averageSeconds: number | null;
    errors: number;
  };
  dataset: {
    totalAnalyses: number;
    uniqueTexts: number;
    reusedAnalyses: number;
    reviewed: number;
    reviewedUniqueTexts: number;
    confirmed: number;
    corrected: number;
    assigned: number;
    skipped: number;
    reviewedToday: number;
    reviewedLast7Days: number;
    activeReviewers: number;
    averageReviewSeconds: number | null;
    progress: number | null;
  };
  nli: {
    eligible: number;
    completed: number;
    assigned: number;
    skipped: number;
    waiting: number;
    activeReviewers: number;
    averageReviewSeconds: number | null;
    progress: number | null;
    layer3: Array<{ level: string; count: number }>;
    layer4: Array<{ code: string; name: string; count: number }>;
  };
  model: {
    sampleSize: number;
    truePositive: number;
    trueNegative: number;
    falsePositive: number;
    falseNegative: number;
    gemmaHate: number;
    goldHate: number;
    agreement: number | null;
    precision: number | null;
    recall: number | null;
    f1: number | null;
    specificity: number | null;
    typeAgreement: number | null;
    examples: {
      falsePositives: ModelErrorExample[];
      falseNegatives: ModelErrorExample[];
    };
  };
  platforms: Array<{
    platform: string;
    total: number;
    reviewed: number;
    corrected: number;
    progress: number | null;
    agreement: number | null;
    precision: number | null;
    recall: number | null;
  }>;
  reviewers: Array<{
    reviewerId: number;
    displayName: string;
    username: string;
    reviewed: number;
    confirmed: number;
    corrected: number;
    skipped: number;
    lastReviewedAt: string | null;
  }>;
  hateTypes: Array<{
    code: string;
    name: string;
    predicted: number;
    gold: number;
    truePositive: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  }>;
  daily: Array<{ date: string; reviewed: number; corrected: number }>;
};

type ModelErrorExample = {
  analysisId: number;
  platform: string;
  text: string;
  gemmaLabel: "hate" | "nao_hate";
  gemmaHateTypes: string[];
  goldLabel: "hate" | "nao_hate";
  goldHateTypes: string[];
  resolvedAt: string;
};

type GemmaDataRow = {
  analysisId: number;
  runId: number;
  runName: string | null;
  contentKind: "post" | "comment";
  platform: string;
  externalId: string;
  text: string;
  modelName: string;
  promptVersion: string;
  status: "success" | "error";
  label: "hate" | "nao_hate" | null;
  hateProbability: number | null;
  hateTypes: string[];
  target: string | null;
  inferenceSeconds: number | null;
  attemptCount: number;
  analyzedAt: string | null;
  reusedFromAnalysisId: number | null;
  canonicalAnalysisId: number;
  duplicateCount: number;
  review: {
    status: string;
    finalLabel: string | null;
    finalHateTypes: string[];
    reviewerName: string | null;
    humanReviewCount: number;
  } | null;
};

type GemmaDataResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: GemmaDataRow[];
  filters: {
    models: Array<{
      model: string;
      promptVersion: string;
      total: number;
    }>;
    hateTypes: Array<{ code: string; name: string }>;
  };
};

type GemmaAnalysisDetail = GemmaDataRow & {
  sourceId: number;
  textHash: string;
  isHate: boolean | null;
  evidence: string | null;
  justification: string | null;
  rawResponse: string | null;
  errorMessage: string | null;
  review: (NonNullable<GemmaDataRow["review"]> & {
    note: string | null;
    reviewerUsername: string | null;
    assignedAt: string | null;
    reviewedAt: string | null;
  }) | null;
};

type AdminNliRow = {
  nliReviewId: number;
  analysisId: number;
  status: "assigned" | "completed" | "skipped" | "invalidated";
  platform: string;
  contentKind: "post" | "comment";
  externalId: string;
  text: string;
  layer3Level: NliLayer3Level | null;
  layer3Answers: Partial<Record<NliLayer3Level, boolean>>;
  layer4Dimensions: string[];
  note: string | null;
  assignedAt: string;
  reviewedAt: string | null;
  invalidatedAt: string | null;
  gold: {
    status: string | null;
    label: string | null;
    hateTypes: string[];
    hateTypeNames: string[];
  };
  reviewer: {
    reviewerId: number;
    name: string;
    username: string;
  };
  model: {
    layer3: {
      modelName: string;
      primaryDimension: string | null;
      primaryScore: number | null;
      activeDimensions: string[];
      toxicityLabel: string | null;
    } | null;
    layer4: {
      modelName: string;
      primaryDimension: string | null;
      primaryScore: number | null;
      activeDimensions: string[];
    } | null;
  };
};

type AdminNliResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: AdminNliRow[];
  filters: {
    reviewers: Array<{ reviewerId: number; name: string; username: string }>;
    dimensions: Array<{ code: string; name: string; description: string }>;
  };
};

type Category = {
  code: string;
  name: string;
  description: string | null;
  positiveExample: string | null;
  boundaryExample: string | null;
};

type OriginPost = {
  externalId: string;
  title: string | null;
  text: string | null;
  author: string | null;
  url: string | null;
  publishedAt: string | null;
};

type ParentComment = {
  externalId: string;
  text: string;
  author: string | null;
  publishedAt: string | null;
};

type ReviewItem = {
  analysisId: number;
  platform: string;
  contentKind: "post" | "comment";
  externalId: string;
  text: string;
  gemmaLabel: "hate" | "nao_hate";
  hateProbability: number;
  hateTypes: string[];
  target: string | null;
  evidence: string | null;
  justification: string;
  analyzedAt: string;
  originPost: OriginPost | null;
  parentComment: ParentComment | null;
  reviewRound: number;
  targetReviews: number;
  duplicateCount: number;
};

type NliReviewItem = {
  analysisId: number;
  platform: string;
  contentKind: "post" | "comment";
  externalId: string;
  text: string;
  goldHateTypes: string[];
  target: string | null;
  analyzedAt: string;
  originPost: OriginPost | null;
  parentComment: ParentComment | null;
  duplicateCount: number;
};

type NliStats = {
  reviewerCompleted: number;
  completed: number;
  assigned: number;
  waiting: number;
};

type NliHistoryEntry = {
  nliReviewId: number;
  analysisId: number;
  platform: string;
  contentKind: "post" | "comment";
  externalId: string;
  text: string;
  goldHateTypes: string[];
  layer3Level: NliLayer3Level;
  layer3Answers: Partial<Record<NliLayer3Level, boolean>>;
  layer4Dimensions: string[];
  note: string;
  reviewedAt: string;
};

type ReviewHistoryEntry = ReviewItem & {
  reviewId: number;
  reviewStatus: "confirmed" | "corrected";
  finalLabel: "hate" | "nao_hate";
  finalHateTypes: string[];
  note: string;
  reviewedAt: string;
};

type ReviewHistoryResponse = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: ReviewHistoryEntry[];
};

type WorkflowOverview = {
  inference: { model: string; promptVersion: string };
  reviewers: Array<{
    reviewerId: number;
    displayName: string;
    username: string;
    role: string;
    doubleReviewEnabled: boolean;
    secondReviews: number;
  }>;
  batches: Array<{
    batchId: number;
    name: string;
    requestedSize: number;
    selectedSize: number;
    doubleReviewPercent: number;
    status: string;
    createdAt: string;
    creatorName: string | null;
    resolvedItems: number;
    conflictItems: number;
    awaitingSecond: number;
  }>;
  conflicts: Array<{
    analysisId: number;
    platform: string;
    contentKind: string;
    text: string;
    gemmaLabel: string;
    gemmaHateTypes: string[];
    hateProbability: number | null;
    updatedAt: string;
    reviews: Array<{
      reviewId: number;
      reviewerId: number;
      reviewerName: string;
      reviewerUsername: string;
      finalLabel: "hate" | "nao_hate";
      finalHateTypes: string[];
      note: string | null;
      reviewedAt: string;
    }>;
  }>;
  audit: Array<{
    auditId: number;
    analysisId: number;
    eventType: string;
    previousValue: Record<string, unknown> | null;
    newValue: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    createdAt: string;
    actorName: string | null;
    actorUsername: string | null;
    platform: string;
    textPreview: string;
    gemmaLabel: string | null;
    gemmaHateTypes: string[];
  }>;
  duplicates: {
    mappedAnalyses: number;
    uniqueTexts: number;
    duplicateRecords: number;
    duplicateGroups: number;
    decisionsReused: number;
  };
  platformCoverageTargetPercent: number;
  platformCoverage: Array<{
    platform: string;
    total: number;
    target: number;
    sampled: number;
    reviewed: number;
    remainingToSample: number;
    remainingToReview: number;
    targetProgress: number;
    datasetCoverage: number;
  }>;
};

type Stats = {
  reviewer: {
    reviewed: number;
    confirmed: number;
    corrected: number;
    skipped: number;
  };
  global: {
    reviewed: number;
    total: number;
  };
};

type ReviewFilters = {
  platform: string;
  contentKind: string;
  gemmaLabel: string;
};

const PLATFORMS = [
  ["", "Todas as redes"],
  ["facebook", "Facebook"],
  ["reddit", "Reddit"],
  ["telegram", "Telegram"],
  ["tiktok", "TikTok"],
  ["twitter", "Twitter"],
  ["whatsapp", "WhatsApp"],
  ["youtube", "YouTube"],
];
const PLATFORM_NAMES = Object.fromEntries(PLATFORMS);

const TYPE_LABELS: Record<string, string> = {
  post: "Post",
  comment: "Comentário",
};

const number = (value: number) => new Intl.NumberFormat("pt-BR").format(value);
const percent = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
const metricPercent = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        style: "percent",
        maximumFractionDigits: value > 0 && value < 0.001 ? 3 : 1,
      }).format(value);
const seconds = (value: number | null) => {
  if (value === null) return "—";
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
};

function LoginScreen({ onLogin }: { onLogin: (reviewer: Reviewer) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/reviewers/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível entrar.");
      onLogin(data.reviewer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-hero">
        <div className="brand-mark" aria-hidden="true">RO</div>
        <span className="eyebrow">RADAR ÓDIO · DATASET GOLD</span>
        <h1>Revisão humana, decisão por decisão.</h1>
        <p>
          Confirme ou corrija as classificações do Gemma com rastreabilidade,
          consistência e poucos cliques.
        </p>
        <div className="hero-points">
          <div><ShieldCheck size={20} /><span>Identificação individual</span></div>
          <div><Sparkles size={20} /><span>Predições já preenchidas</span></div>
          <div><Target size={20} /><span>Gold dataset auditável</span></div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <span className="step-label">ACESSO DO AVALIADOR</span>
          <h2>Entre para começar</h2>
          <p>Use o usuário e a senha temporária fornecidos pela administração.</p>
          <form onSubmit={submit}>
            <label>
              Usuário
              <input
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))
                }
                placeholder="Ex.: ana.silva"
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite sua senha"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={17} />{error}
              </div>
            )}
            <button className="primary-button" disabled={loading}>
              {loading ? "Entrando..." : "Entrar na revisão"}
              <ArrowRight size={18} />
            </button>
          </form>
          <small>
            Cada decisão salva fica vinculada à sua conta individual.
          </small>
        </div>
      </section>
    </main>
  );
}

function PasswordChangeScreen({
  reviewer,
  onChanged,
  onLogout,
}: {
  reviewer: Reviewer;
  onChanged: (reviewer: Reviewer) => void;
  onLogout: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setError("As senhas digitadas não são iguais.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/reviewers/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível alterar a senha.");
      }
      onChanged(data.reviewer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao alterar a senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="password-shell">
      <section className="password-card">
        <div className="password-icon"><KeyRound size={26} /></div>
        <span className="step-label">PRIMEIRO ACESSO</span>
        <h1>Crie sua senha definitiva</h1>
        <p>
          Olá, {reviewer.displayName}. A senha temporária só serve para o primeiro
          acesso.
        </p>
        <form onSubmit={submit}>
          <label>
            Nova senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <label>
            Confirme a nova senha
            <input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
          <small>
            Use pelo menos 10 caracteres, com maiúscula, minúscula, número e
            caractere especial.
          </small>
          {error && (
            <div className="form-error" role="alert">
              <AlertCircle size={17} />{error}
            </div>
          )}
          <button className="primary-button" disabled={loading}>
            {loading ? "Salvando..." : "Salvar nova senha"}
            <ArrowRight size={18} />
          </button>
          <button className="password-logout" type="button" onClick={onLogout}>
            Sair e usar outra conta
          </button>
        </form>
      </section>
    </main>
  );
}

export default function Home() {
  const [reviewer, setReviewer] = useState<Reviewer | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [item, setItem] = useState<ReviewItem | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nliHistoryOpen, setNliHistoryOpen] = useState(false);
  const [expandedText, setExpandedText] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [finalLabel, setFinalLabel] = useState<"hate" | "nao_hate">("hate");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [nliAnswers, setNliAnswers] = useState<
    Partial<Record<NliLayer3Level, boolean>>
  >({});
  const [nliDimensions, setNliDimensions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [filters, setFilters] = useState<ReviewFilters>({
    platform: "",
    contentKind: "",
    gemmaLabel: "",
  });
  const filtersRef = useRef<ReviewFilters>(filters);
  const requestSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  const categoryNames = useMemo(
    () =>
      Object.fromEntries(
        categories.map((category) => [category.code, category.name]),
      ),
    [categories],
  );

  const loadStats = useCallback(async () => {
    const response = await fetch("/api/reviews/stats");
    if (response.ok) setStats(await response.json());
  }, []);

  const loadNext = useCallback(async (requestedFilters?: ReviewFilters) => {
    const activeFilters = requestedFilters || filtersRef.current;
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError("");
    setCorrectionOpen(false);
    setReaderOpen(false);
    setNote("");
    setNliAnswers({});
    setNliDimensions([]);
    try {
      const params = new URLSearchParams();
      if (activeFilters.platform) {
        params.set("platform", activeFilters.platform);
      }
      if (activeFilters.contentKind) {
        params.set("contentKind", activeFilters.contentKind);
      }
      if (activeFilters.gemmaLabel) {
        params.set("gemmaLabel", activeFilters.gemmaLabel);
      }
      const response = await fetch(`/api/reviews/next?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json();
      if (requestSequence !== requestSequenceRef.current) return;
      if (response.status === 401) {
        setReviewer(null);
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "Falha ao buscar o próximo texto.");
      }
      setItem(data.item);
      setExpandedText(false);
      setCategories(data.categories || []);
      if (data.item) {
        setFinalLabel(data.item.gemmaLabel);
        setSelectedTypes(data.item.hateTypes);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (requestSequence === requestSequenceRef.current) {
        setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const applyFilters = useCallback(
    (nextFilters: ReviewFilters) => {
      filtersRef.current = nextFilters;
      setFilters(nextFilters);
      void loadNext(nextFilters);
    },
    [loadNext],
  );

  useEffect(() => {
    fetch("/api/reviewers/me")
      .then(async (response) => {
        if (response.ok) setReviewer((await response.json()).reviewer);
      })
      .finally(() => setCheckingSession(false));
  }, []);

  useEffect(() => {
    if (reviewer && !reviewer.mustChangePassword) {
      const timer = window.setTimeout(() => {
        void loadNext();
        void loadStats();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [reviewer, loadNext, loadStats]);

  useEffect(() => {
    if (
      !reviewer ||
      reviewer.mustChangePassword ||
      loading ||
      item ||
      error
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadNext();
    }, 8_000);
    return () => window.clearTimeout(timer);
  }, [error, filters, item, loadNext, loading, reviewer]);

  const submitReview = useCallback(
    async (action: "confirmed" | "corrected" | "skipped") => {
      if (!item || submitting) return;
      if (
        action === "confirmed" &&
        item.gemmaLabel === "hate" &&
        item.hateTypes.length === 0
      ) {
        setError(
          "A categoria genérica foi removida. Corrija a classificação e escolha um tipo específico.",
        );
        setFinalLabel("hate");
        setSelectedTypes([]);
        setCorrectionOpen(true);
        return;
      }
      if (
        action === "corrected" &&
        finalLabel === "hate" &&
        selectedTypes.length === 0
      ) {
        setError("Selecione ao menos um tipo para classificar como hate.");
        return;
      }
      const submittedLabel =
        action === "confirmed" ? item.gemmaLabel : finalLabel;
      const selectedNliQuestion = NLI_LAYER3_QUESTIONS.find(
        (question) => nliAnswers[question.level] === true,
      );
      const allNliQuestionsAreNo = NLI_LAYER3_QUESTIONS.every(
        (question) => nliAnswers[question.level] === false,
      );
      if (
        action !== "skipped" &&
        submittedLabel === "hate" &&
        !selectedNliQuestion &&
        !allNliQuestionsAreNo
      ) {
        setError("Conclua a sequência da Camada 3 antes de salvar.");
        return;
      }
      setSubmitting(true);
      setError("");
      try {
        const response = await fetch(`/api/reviews/${item.analysisId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            finalLabel: action === "corrected" ? finalLabel : undefined,
            finalHateTypes:
              action === "corrected" && finalLabel === "hate"
                ? selectedTypes
                : [],
            nliLayer3Answers:
              action !== "skipped" && submittedLabel === "hate"
                ? nliAnswers
                : undefined,
            nliLayer4Dimensions:
              action !== "skipped" && submittedLabel === "hate"
                ? nliDimensions
                : undefined,
            note,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Não foi possível salvar.");
        }
        const messages = {
          confirmed: "Classificação confirmada.",
          corrected: "Correção registrada.",
          skipped: "Item pulado.",
        };
        setNotice(
          data.nliSaved && action !== "skipped"
            ? `${messages[action]} Camadas NLI salvas na mesma sequência.`
            : messages[action],
        );
        window.setTimeout(() => setNotice(""), 2200);
        await Promise.all([loadNext(), loadStats()]);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Falha ao salvar.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      finalLabel,
      item,
      loadNext,
      loadStats,
      note,
      nliAnswers,
      nliDimensions,
      selectedTypes,
      submitting,
    ],
  );

  const openCorrection = useCallback(
    (label?: "hate" | "nao_hate") => {
      if (!item) return;
      const nextLabel = label || item.gemmaLabel;
      setFinalLabel(nextLabel);
      setSelectedTypes(nextLabel === "hate" ? item.hateTypes : []);
      setNliAnswers({});
      setNliDimensions([]);
      setCorrectionOpen(true);
      setError("");
    },
    [item],
  );

  const saveIntegratedReview = useCallback(() => {
    if (!item) return;
    const sameLabel = finalLabel === item.gemmaLabel;
    const sameTypes =
      finalLabel !== "hate" ||
      JSON.stringify([...selectedTypes].sort()) ===
        JSON.stringify([...item.hateTypes].sort());
    void submitReview(sameLabel && sameTypes ? "confirmed" : "corrected");
  }, [finalLabel, item, selectedTypes, submitReview]);

  async function logout() {
    await fetch("/api/reviewers/logout", { method: "POST" });
    setReviewer(null);
    setItem(null);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLargeText(
        window.localStorage.getItem("gold-review-reader-size") === "large",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!readerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [readerOpen]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "Escape") {
        if (readerOpen) {
          setReaderOpen(false);
          return;
        }
        if (guideOpen) {
          setGuideOpen(false);
          return;
        }
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        if (nliHistoryOpen) {
          setNliHistoryOpen(false);
          return;
        }
        if (adminOpen) {
          setAdminOpen(false);
          return;
        }
        if (correctionOpen) {
          setCorrectionOpen(false);
          return;
        }
      }
      if (
        readerOpen ||
        guideOpen ||
        historyOpen ||
        nliHistoryOpen ||
        adminOpen ||
        submitting
      ) {
        return;
      }
      if (event.key.toLowerCase() === "c" && item && !correctionOpen) {
        if (item.gemmaLabel === "hate") openCorrection("hate");
        else submitReview("confirmed");
      }
      if (event.key.toLowerCase() === "e" && item) openCorrection();
      if (event.key.toLowerCase() === "p" && item) submitReview("skipped");
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [
    adminOpen,
    correctionOpen,
    guideOpen,
    historyOpen,
    nliHistoryOpen,
    item,
    openCorrection,
    readerOpen,
    submitReview,
    submitting,
  ]);

  function toggleReaderSize() {
    const next = !largeText;
    setLargeText(next);
    window.localStorage.setItem(
      "gold-review-reader-size",
      next ? "large" : "normal",
    );
  }

  if (checkingSession) {
    return (
      <main className="loading-screen">
        <div className="brand-mark">RO</div>
        <p>Preparando sua sessão de revisão…</p>
      </main>
    );
  }

  if (!reviewer) return <LoginScreen onLogin={setReviewer} />;
  if (reviewer.mustChangePassword) {
    return (
      <PasswordChangeScreen
        reviewer={reviewer}
        onChanged={setReviewer}
        onLogout={logout}
      />
    );
  }

  const globalProgress =
    stats && stats.global.total > 0
      ? stats.global.reviewed / stats.global.total
      : 0;
  const canConfirmGemma =
    !item || item.gemmaLabel !== "hate" || item.hateTypes.length > 0;

  return (
    <main className="review-app">
      <header className="app-header">
        <div className="header-brand">
          <div className="brand-mark small">RO</div>
          <div><strong>Radar Ódio</strong><span>Revisão humana</span></div>
        </div>
        {reviewer.role === "admin" && (
          <button className="admin-button" onClick={() => setAdminOpen(true)}>
            <Settings size={18} />
            Painel administrativo
          </button>
        )}
        <div className="reviewer-menu">
          <CircleUserRound size={21} />
          <div>
            <strong>{reviewer.displayName}</strong>
            <span>@{reviewer.username}</span>
          </div>
          <button onClick={logout} title="Sair" aria-label="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <span className="eyebrow">SEU TRABALHO</span>
          <div className="stat-stack">
            <SideStat
              icon={<Check size={18} />}
              value={stats?.reviewer.reviewed || 0}
              label="Revisados"
            />
            <SideStat
              icon={<ShieldCheck size={18} />}
              value={stats?.reviewer.confirmed || 0}
              label="Confirmados"
            />
            <SideStat
              icon={<Edit3 size={18} />}
              value={stats?.reviewer.corrected || 0}
              label="Corrigidos"
            />
          </div>

          <div className="global-progress">
            <div><span>Revisão geral</span><strong>{percent(globalProgress)}</strong></div>
            <div className="progress-track">
              <span style={{ width: `${globalProgress * 100}%` }} />
            </div>
            <small>
              {number(stats?.global.reviewed || 0)} de{" "}
              {number(stats?.global.total || 0)}
            </small>
          </div>

          <button
            className="history-open-button"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={18} />
            <span>
              <strong>Minhas avaliações</strong>
              <small>Rever e corrigir decisões anteriores</small>
            </span>
            <ChevronRight size={16} />
          </button>

          <button
            className="history-open-button"
            onClick={() => setNliHistoryOpen(true)}
          >
            <Layers3 size={18} />
            <span>
              <strong>Minhas avaliações NLI</strong>
              <small>Rever gravidade e dimensões anteriores</small>
            </span>
            <ChevronRight size={16} />
          </button>

          <div className="shortcut-card">
            <strong>Atalhos</strong>
            <span><kbd>C</kbd> Confirmar</span>
            <span><kbd>E</kbd> Corrigir</span>
            <span><kbd>P</kbd> Pular</span>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-top">
            <div>
              <span className="eyebrow">FILA DE VALIDAÇÃO</span>
              <h1>Revisar classificação</h1>
            </div>
            <div className="workspace-controls">
              <FilterBar
                filters={filters}
                setFilters={applyFilters}
                reload={loadNext}
              />
              <button
                className="reader-size-button"
                onClick={toggleReaderSize}
                aria-pressed={largeText}
                title={
                  largeText
                    ? "Voltar ao tamanho normal"
                    : "Aumentar o texto original"
                }
              >
                {largeText ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                {largeText ? "Texto normal" : "Texto maior"}
              </button>
              <button
                className="guide-button"
                onClick={() => setGuideOpen(true)}
              >
                <BookOpen size={17} />
                Guia de rotulagem
              </button>
            </div>
          </div>

          {notice && (
            <div className="toast" role="status" aria-live="polite">
              <Check size={17} />
              {notice}
            </div>
          )}
          {error && (
            <div className="workspace-error" role="alert">
              <AlertCircle size={18} />
              {error}
            </div>
          )}

          {loading ? (
            <div className="review-card loading-card">
              <div className="pulse-line wide" />
              <div className="pulse-line" />
              <div className="pulse-block" />
            </div>
          ) : !item ? (
            <div className="review-card empty-card">
              <ShieldCheck size={42} />
              <h2>Fila concluída para estes filtros</h2>
              <p>
                Altere os filtros ou tente buscar novamente. A fila também
                será atualizada automaticamente.
              </p>
              <button
                className="empty-retry-button"
                onClick={() => void loadNext()}
              >
                <RotateCcw size={16} />
                Buscar novamente
              </button>
              {Object.values(filters).some(Boolean) && (
                <button
                  className="primary-button empty-reset-button"
                  onClick={() =>
                    applyFilters({
                      platform: "",
                      contentKind: "",
                      gemmaLabel: "",
                    })
                  }
                >
                  Limpar filtros e continuar
                </button>
              )}
            </div>
          ) : (
            <article className="review-card">
              <div className="content-heading">
                <div className="meta-chips">
                  <span className={`platform-chip ${item.platform}`}>
                    {item.platform}
                  </span>
                  <span>{TYPE_LABELS[item.contentKind]}</span>
                  <span className="muted-id">#{item.analysisId}</span>
                  {item.targetReviews === 2 && (
                    <span className="double-review-chip">
                      Revisão dupla · etapa {item.reviewRound}/2
                    </span>
                  )}
                  {item.duplicateCount > 0 && (
                    <span className="duplicate-chip">
                      {number(item.duplicateCount)} duplicata(s) exata(s)
                    </span>
                  )}
                </div>
                <div className="timestamp">
                  <Clock3 size={15} />
                  {new Date(item.analyzedAt).toLocaleDateString("pt-BR")}
                </div>
              </div>

              <div className="review-grid">
                <section className="text-panel">
                  <div className="source-heading">
                    <div>
                      <span className="section-label">
                        {item.contentKind === "comment"
                          ? "COMENTÁRIO AVALIADO"
                          : "CONTEÚDO ORIGINAL"}
                      </span>
                      <p>Role dentro da caixa para ler todo o conteúdo.</p>
                    </div>
                    <div className="source-heading-actions">
                      {item.text.length > 850 && (
                        <button
                          className="expand-text-button"
                          onClick={() =>
                            setExpandedText((current) => !current)
                          }
                          aria-expanded={expandedText}
                        >
                          {expandedText ? (
                            <Minimize2 size={15} />
                          ) : (
                            <Maximize2 size={15} />
                          )}
                          {expandedText ? "Reduzir área" : "Aumentar área"}
                        </button>
                      )}
                      <button
                        className="reading-mode-button"
                        onClick={() => setReaderOpen(true)}
                      >
                        <BookOpen size={16} />
                        Abrir modo leitura
                      </button>
                    </div>
                  </div>
                  {item.contentKind === "comment" && (
                    <OriginContext
                      key={item.analysisId}
                      originPost={item.originPost}
                      parentComment={item.parentComment}
                    />
                  )}
                  <div
                    className={`source-reader ${expandedText ? "expanded" : ""}`}
                  >
                    <div
                      className={`source-text ${largeText ? "large" : ""}`}
                      tabIndex={0}
                      aria-label="Texto original para avaliação"
                    >
                      {item.text}
                    </div>
                  </div>
                  <div className="source-footer">
                    <span className="external-id">
                      ID de origem: {item.externalId}
                    </span>
                    <span>{number(item.text.length)} caracteres</span>
                  </div>
                </section>

                <aside className="model-panel">
                  <span className="section-label">ANÁLISE DO GEMMA</span>
                  <p className="model-disclaimer">
                    Use a predição como referência. A decisão final deve seguir
                    o conteúdo e o guia de rotulagem.
                  </p>
                  <div className="model-verdict">
                    <span className={`verdict ${item.gemmaLabel}`}>
                      {item.gemmaLabel === "hate" ? "HATE" : "NÃO HATE"}
                    </span>
                    <strong>{percent(item.hateProbability)}</strong>
                  </div>
                  {item.hateTypes.length > 0 && (
                    <ModelSection title="Tipos identificados">
                      <div className="type-tags">
                        {item.hateTypes.map((type) => (
                          <em key={type}>{categoryNames[type] || type}</em>
                        ))}
                      </div>
                    </ModelSection>
                  )}
                  {item.target && (
                    <ModelSection title="Alvo identificado">
                      <p>{item.target}</p>
                    </ModelSection>
                  )}
                  {item.evidence && (
                    <ModelSection title="Evidência textual">
                      <blockquote>“{item.evidence}”</blockquote>
                    </ModelSection>
                  )}
                  <ModelSection title="Justificativa">
                    <p>{item.justification}</p>
                  </ModelSection>
                </aside>
              </div>

              {correctionOpen ? (
                <CorrectionPanel
                  categories={categories}
                  finalLabel={finalLabel}
                  setFinalLabel={setFinalLabel}
                  selectedTypes={selectedTypes}
                  setSelectedTypes={setSelectedTypes}
                  note={note}
                  setNote={setNote}
                  gemmaLabel={item.gemmaLabel}
                  gemmaHateTypes={item.hateTypes}
                  close={() => setCorrectionOpen(false)}
                  save={saveIntegratedReview}
                  submitting={submitting}
                  nliAnswers={nliAnswers}
                  setNliAnswers={setNliAnswers}
                  nliDimensions={nliDimensions}
                  setNliDimensions={setNliDimensions}
                  includeNli
                />
              ) : (
                <footer className="action-bar">
                  <div className="action-primary">
                    <button
                      className="confirm-button"
                      onClick={() =>
                        item.gemmaLabel === "hate"
                          ? openCorrection("hate")
                          : submitReview("confirmed")
                      }
                      disabled={submitting || !canConfirmGemma}
                      title={
                        canConfirmGemma
                          ? undefined
                          : "Escolha um tipo específico em Corrigir classificação."
                      }
                    >
                      {submitting ? (
                        <>
                          <RotateCcw className="spin" size={18} />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Check size={20} />
                          Confirmar Gemma
                          <kbd>C</kbd>
                        </>
                      )}
                    </button>
                    <button
                      className="correct-button"
                      onClick={() => openCorrection()}
                      disabled={submitting}
                    >
                      <Edit3 size={19} />Corrigir classificação<kbd>E</kbd>
                    </button>
                  </div>
                  <div className="action-support">
                    <small>Ao salvar, o próximo item será carregado.</small>
                    <button
                      className="skip-button"
                      onClick={() => submitReview("skipped")}
                      disabled={submitting}
                    >
                      <SkipForward size={18} />Pular<kbd>P</kbd>
                    </button>
                  </div>
                </footer>
              )}
            </article>
          )}
        </section>
      </div>
      {guideOpen && (
        <LabelingGuide
          categories={categories}
          close={() => setGuideOpen(false)}
        />
      )}
      {readerOpen && item && (
        <div
          className="reading-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setReaderOpen(false);
          }}
        >
          <section
            className="reading-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-title"
          >
            <header className="reading-header">
              <div>
                <span className="eyebrow">MODO LEITURA</span>
                <h2 id="reading-title">Conteúdo original</h2>
                <p>
                  {item.platform} · {TYPE_LABELS[item.contentKind]} ·{" "}
                  {number(item.text.length)} caracteres
                </p>
              </div>
              <div className="reading-header-actions">
                <button
                  className="reader-size-button"
                  onClick={toggleReaderSize}
                  aria-pressed={largeText}
                >
                  {largeText ? (
                    <Minimize2 size={16} />
                  ) : (
                    <Maximize2 size={16} />
                  )}
                  {largeText ? "Fonte normal" : "Fonte maior"}
                </button>
                <button
                  className="reading-close-button"
                  onClick={() => setReaderOpen(false)}
                  aria-label="Fechar modo leitura"
                  title="Fechar modo leitura"
                >
                  <X size={21} />
                </button>
              </div>
            </header>
            <div
              className={`reading-text ${largeText ? "large" : ""}`}
              tabIndex={0}
            >
              {item.text}
            </div>
            <footer className="reading-footer">
              <span>ID de origem: {item.externalId}</span>
              <span>Pressione Esc para fechar</span>
            </footer>
          </section>
        </div>
      )}
      {historyOpen && (
        <ReviewHistoryPanel
          categories={categories}
          close={() => setHistoryOpen(false)}
          onUpdated={() => {
            setNotice("Avaliação anterior atualizada.");
            window.setTimeout(() => setNotice(""), 2200);
            void loadStats();
          }}
        />
      )}
      {nliHistoryOpen && (
        <NliHistoryPanel
          categoryNames={categoryNames}
          close={() => setNliHistoryOpen(false)}
          onUpdated={() => {
            setNotice("Avaliação NLI anterior atualizada.");
            window.setTimeout(() => setNotice(""), 2200);
            void loadStats();
          }}
        />
      )}
      {adminOpen && <AdminPanel close={() => setAdminOpen(false)} />}
    </main>
  );
}

// Mantido apenas para compatibilidade com o histórico e a API da fila antiga.
// A interface principal agora usa InlineNliLayers na mesma sequência.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function NliWorkspace({
  categoryNames,
  onGoldStatsChanged,
}: {
  categoryNames: Record<string, string>;
  onGoldStatsChanged: () => Promise<void>;
}) {
  const [item, setItem] = useState<NliReviewItem | null>(null);
  const [stats, setStats] = useState<NliStats | null>(null);
  const [platform, setPlatform] = useState("");
  const [answers, setAnswers] = useState<
    Partial<Record<NliLayer3Level, boolean>>
  >({});
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const selectedQuestion = NLI_LAYER3_QUESTIONS.find(
    (question) => answers[question.level] === true,
  );
  const allExplicitQuestionsAreNo = NLI_LAYER3_QUESTIONS.every(
    (question) => answers[question.level] === false,
  );
  const selectedLevel: NliLayer3Level | null = selectedQuestion
    ? selectedQuestion.level
    : allExplicitQuestionsAreNo
      ? "N1"
      : null;
  const currentQuestionIndex = selectedLevel
    ? -1
    : NLI_LAYER3_QUESTIONS.findIndex(
        (question) => answers[question.level] === undefined,
      );

  const resetForm = useCallback(() => {
    setAnswers({});
    setSelectedDimensions([]);
    setNote("");
  }, []);

  const loadNext = useCallback(
    async (requestedPlatform = platform) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (requestedPlatform) params.set("platform", requestedPlatform);
        const response = await fetch(`/api/nli/next?${params.toString()}`);
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "Não foi possível carregar a fila NLI.");
        }
        setItem(body.item || null);
        setStats(body.stats || null);
        resetForm();
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Falha ao carregar a fila NLI.",
        );
      } finally {
        setLoading(false);
      }
    },
    [platform, resetForm],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNext(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNext]);

  async function submit(action: "completed" | "skipped") {
    if (!item || submitting) return;
    if (action === "completed" && !selectedLevel) {
      setError("Conclua a sequência da Camada 3 antes de salvar.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/nli/${item.analysisId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          layer3Answers: action === "completed" ? answers : undefined,
          layer4Dimensions:
            action === "completed" ? selectedDimensions : undefined,
          note,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível salvar a avaliação NLI.");
      }
      setNotice(
        action === "completed"
          ? `Camadas NLI salvas com nível ${body.layer3Level}.`
          : "Item NLI pulado e liberado para outro avaliador.",
      );
      window.setTimeout(() => setNotice(""), 2600);
      await Promise.all([loadNext(), onGoldStatsChanged()]);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao salvar a avaliação NLI.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function changePlatform(nextPlatform: string) {
    setPlatform(nextPlatform);
  }

  return (
    <div className="nli-workspace">
      <div className="workspace-top nli-workspace-top">
        <div>
          <span className="eyebrow">FILA NLI DO DATASET GOLD</span>
          <h1>Avaliar gravidade e dimensões</h1>
          <p>
            Disponível apenas para textos confirmados por humanos como HATE.
          </p>
        </div>
        <div className="workspace-controls">
          <SelectWrap label="Rede social">
            <select
              value={platform}
              onChange={(event) => changePlatform(event.target.value)}
            >
              {PLATFORMS.map(([value, label]) => (
                <option key={label} value={value}>{label}</option>
              ))}
            </select>
          </SelectWrap>
          <button
            className="icon-button"
            onClick={() => void loadNext()}
            title="Atualizar fila NLI"
            aria-label="Atualizar fila NLI"
          >
            <RotateCcw size={17} />
          </button>
          <button
            className="nli-history-button"
            onClick={() => setHistoryOpen(true)}
          >
            <History size={16} />Minhas NLI
          </button>
        </div>
      </div>

      <div className="nli-queue-summary" aria-label="Resumo da fila NLI">
        <span><strong>{number(stats?.reviewerCompleted || 0)}</strong> suas avaliações</span>
        <span><strong>{number(stats?.completed || 0)}</strong> NLI concluídos</span>
        <span><strong>{number(stats?.waiting || 0)}</strong> aguardando</span>
      </div>

      {notice && (
        <div className="toast" role="status" aria-live="polite">
          <Check size={17} />{notice}
        </div>
      )}
      {error && (
        <div className="workspace-error" role="alert">
          <AlertCircle size={18} />{error}
        </div>
      )}

      {loading ? (
        <div className="review-card loading-card">
          <div className="pulse-line wide" />
          <div className="pulse-line" />
          <div className="pulse-block" />
        </div>
      ) : !item ? (
        <div className="review-card empty-card">
          <Layers3 size={42} />
          <h2>Não há itens HATE pendentes nesta fila</h2>
          <p>
            Novos itens aparecem aqui assim que a classificação humana de
            HATE for consolidada.
          </p>
          <button className="empty-retry-button" onClick={() => void loadNext()}>
            <RotateCcw size={16} />Buscar novamente
          </button>
          {platform && (
            <button
              className="primary-button empty-reset-button"
              onClick={() => changePlatform("")}
            >
              Limpar filtro de rede
            </button>
          )}
        </div>
      ) : (
        <article className="review-card nli-review-card">
          <div className="content-heading">
            <div className="meta-chips">
              <span className={`platform-chip ${item.platform}`}>
                {PLATFORM_NAMES[item.platform] || item.platform}
              </span>
              <span>{TYPE_LABELS[item.contentKind]}</span>
              <span className="muted-id">#{item.analysisId}</span>
              {item.duplicateCount > 0 && (
                <span className="duplicate-chip">
                  {number(item.duplicateCount)} duplicata(s) reaproveitável(is)
                </span>
              )}
            </div>
            <span className="nli-gold-badge"><ShieldCheck size={15} />GOLD HATE</span>
          </div>

          <div className="nli-source-layout">
            <section className="text-panel">
              <div className="source-heading">
                <div>
                  <span className="section-label">
                    {item.contentKind === "comment"
                      ? "COMENTÁRIO AVALIADO"
                      : "CONTEÚDO AVALIADO"}
                  </span>
                  <p>Leia o texto e o contexto antes de responder.</p>
                </div>
              </div>
              {item.contentKind === "comment" && (
                <OriginContext
                  key={item.analysisId}
                  originPost={item.originPost}
                  parentComment={item.parentComment}
                />
              )}
              <div className="source-reader nli-source-reader">
                <div className="source-text" tabIndex={0}>{item.text}</div>
              </div>
              <div className="source-footer">
                <span>ID de origem: {item.externalId}</span>
                <span>{number(item.text.length)} caracteres</span>
              </div>
            </section>

            <aside className="nli-gold-context">
              <span className="section-label">DECISÃO HUMANA ANTERIOR</span>
              <strong>Discurso de ódio confirmado</strong>
              <div className="type-tags">
                {item.goldHateTypes.map((type) => (
                  <em key={type}>{categoryNames[type] || type}</em>
                ))}
              </div>
              {item.target && (
                <div>
                  <span>Alvo identificado</span>
                  <p>{item.target}</p>
                </div>
              )}
              <small>
                A predição NLI do modelo não é mostrada durante a rotulagem
                para reduzir viés de ancoragem.
              </small>
            </aside>
          </div>

          <section className="nli-layer-card">
            <header>
              <div className="nli-layer-number">3</div>
              <div>
                <span className="section-label">CAMADA 3</span>
                <h2>Qual é o nível de gravidade?</h2>
                <p>
                  Responda em ordem. A sequência para no primeiro “sim”.
                </p>
              </div>
              {selectedLevel && (
                <div className={`nli-level-result ${selectedLevel.toLowerCase()}`}>
                  <span>Nível definido</span><strong>{selectedLevel}</strong>
                </div>
              )}
            </header>

            <div className="nli-question-flow">
              {NLI_LAYER3_QUESTIONS.map((question, index) => {
                const answer = answers[question.level];
                const visible =
                  answer !== undefined || index === currentQuestionIndex;
                if (!visible) return null;
                const active = index === currentQuestionIndex;
                return (
                  <div
                    className={`nli-question ${active ? "active" : "answered"}`}
                    key={question.level}
                  >
                    <span className="nli-question-level">{question.level}</span>
                    <div>
                      <strong>{question.question}</strong>
                      <small>{question.explanation}</small>
                    </div>
                    {active ? (
                      <div className="nli-binary-actions">
                        <button onClick={() => setAnswers((value) => ({
                          ...value,
                          [question.level]: false,
                        }))}>Não</button>
                        <button className="yes" onClick={() => setAnswers((value) => ({
                          ...value,
                          [question.level]: true,
                        }))}>Sim</button>
                      </div>
                    ) : (
                      <span className={`nli-answer ${answer ? "yes" : "no"}`}>
                        {answer ? "Sim" : "Não"}
                      </span>
                    )}
                  </div>
                );
              })}
              {selectedLevel === "N1" && (
                <div className="nli-question n1-result">
                  <span className="nli-question-level">N1</span>
                  <div>
                    <strong>Preconceito implícito ou velado</strong>
                    <small>
                      Estereótipo, piada ou referência negativa sem os sinais
                      mais graves descritos acima.
                    </small>
                  </div>
                  <span className="nli-answer yes">Resultado</span>
                </div>
              )}
            </div>
            {Object.keys(answers).length > 0 && (
              <button className="nli-reset-layer" onClick={() => setAnswers({})}>
                <RotateCcw size={14} />Recomeçar Camada 3
              </button>
            )}
          </section>

          <section className={`nli-layer-card ${!selectedLevel ? "locked" : ""}`}>
            <header>
              <div className="nli-layer-number">4</div>
              <div>
                <span className="section-label">CAMADA 4</span>
                <h2>Quais dimensões estão presentes?</h2>
                <p>Marque nenhuma, uma ou várias dimensões.</p>
              </div>
              <span className="nli-selection-count">
                {number(selectedDimensions.length)} selecionada(s)
              </span>
            </header>
            {selectedLevel ? (
              <div className="nli-dimension-grid">
                {NLI_LAYER4_DIMENSIONS.map((dimension) => {
                  const selected = selectedDimensions.includes(dimension.code);
                  return (
                    <button
                      key={dimension.code}
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      onClick={() => setSelectedDimensions((current) =>
                        selected
                          ? current.filter((code) => code !== dimension.code)
                          : [...current, dimension.code],
                      )}
                    >
                      <span className="nli-dimension-check">
                        {selected && <Check size={15} />}
                      </span>
                      <span>
                        <strong>{dimension.name}</strong>
                        <small>{dimension.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="nli-layer-locked-message">
                <Layers3 size={20} />Conclua a Camada 3 para liberar esta etapa.
              </div>
            )}
          </section>

          {selectedLevel && (
            <div className="nli-submit-area">
              <label className="note-field">
                Observação <span>(opcional)</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Registre somente informações úteis para auditoria."
                  maxLength={2000}
                />
              </label>
              <div className="nli-submit-summary">
                <span>
                  Camada 3: <strong>{selectedLevel}</strong> · Camada 4:{" "}
                  <strong>
                    {selectedDimensions.length
                      ? `${selectedDimensions.length} dimensão(ões)`
                      : "nenhuma dimensão"}
                  </strong>
                </span>
                <button
                  className="save-correction"
                  disabled={submitting}
                  onClick={() => void submit("completed")}
                >
                  {submitting ? (
                    <><RotateCcw className="spin" size={17} />Salvando...</>
                  ) : (
                    <><Check size={18} />Salvar NLI e avançar</>
                  )}
                </button>
              </div>
            </div>
          )}

          <footer className="nli-skip-footer">
            <small>Não tem certeza? Libere este item para outro avaliador.</small>
            <button disabled={submitting} onClick={() => void submit("skipped")}>
              <SkipForward size={17} />Pular item NLI
            </button>
          </footer>
        </article>
      )}
      {historyOpen && (
        <NliHistoryPanel
          categoryNames={categoryNames}
          close={() => setHistoryOpen(false)}
          onUpdated={() => void loadNext()}
        />
      )}
    </div>
  );
}

function NliHistoryPanel({
  categoryNames,
  close,
  onUpdated,
}: {
  categoryNames: Record<string, string>;
  close: () => void;
  onUpdated: () => void;
}) {
  const [rows, setRows] = useState<NliHistoryEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<NliHistoryEntry | null>(null);
  const [answers, setAnswers] = useState<
    Partial<Record<NliLayer3Level, boolean>>
  >({});
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      const response = await fetch(`/api/nli/history?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível carregar o histórico NLI.");
      }
      setRows(body.rows || []);
      setTotal(Number(body.total || 0));
      setTotalPages(Number(body.totalPages || 1));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha no histórico NLI.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  function edit(entry: NliHistoryEntry) {
    setSelected(entry);
    setAnswers(entry.layer3Answers || {});
    setDimensions(entry.layer4Dimensions || []);
    setNote(entry.note || "");
    setError("");
  }

  const chosenQuestion = NLI_LAYER3_QUESTIONS.find(
    (question) => answers[question.level] === true,
  );
  const allNo = NLI_LAYER3_QUESTIONS.every(
    (question) => answers[question.level] === false,
  );
  const level: NliLayer3Level | null = chosenQuestion
    ? chosenQuestion.level
    : allNo
      ? "N1"
      : null;
  const currentIndex = level
    ? -1
    : NLI_LAYER3_QUESTIONS.findIndex(
        (question) => answers[question.level] === undefined,
      );

  async function save() {
    if (!selected || !level || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/nli/${selected.analysisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layer3Answers: answers,
          layer4Dimensions: dimensions,
          note,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível atualizar a avaliação NLI.");
      }
      setSelected(null);
      await loadHistory();
      onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao atualizar NLI.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="history-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nli-history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="history-panel nli-history-panel">
        <header className="history-heading">
          <div>
            <span className="eyebrow">HISTÓRICO DAS CAMADAS</span>
            <h2 id="nli-history-title">Minhas avaliações NLI</h2>
            <p>Consulte e corrija gravidade, respostas e dimensões.</p>
          </div>
          <button onClick={close} aria-label="Fechar histórico NLI"><X size={20} /></button>
        </header>

        {error && (
          <div className="workspace-error" role="alert">
            <AlertCircle size={18} />{error}
          </div>
        )}

        {selected ? (
          <div className="history-editor nli-history-editor">
            <button className="history-back-button" onClick={() => setSelected(null)}>
              <ChevronLeft size={17} />Voltar ao histórico
            </button>
            <div className="history-review-context">
              <div className="history-review-meta">
                <span className={`platform-chip ${selected.platform}`}>
                  {PLATFORM_NAMES[selected.platform] || selected.platform}
                </span>
                <span>#{selected.analysisId}</span>
                <time>{new Date(selected.reviewedAt).toLocaleString("pt-BR")}</time>
              </div>
              <span className="section-label">CONTEÚDO AVALIADO</span>
              <div className="history-full-text">{selected.text}</div>
              <div className="type-tags nli-history-types">
                {selected.goldHateTypes.map((type) => (
                  <em key={type}>{categoryNames[type] || type}</em>
                ))}
              </div>
            </div>

            <section className="nli-layer-card">
              <header>
                <div className="nli-layer-number">3</div>
                <div><span className="section-label">CAMADA 3</span><h2>Revisar gravidade</h2></div>
                {level && <div className="nli-level-result"><span>Nível</span><strong>{level}</strong></div>}
              </header>
              <div className="nli-question-flow">
                {NLI_LAYER3_QUESTIONS.map((question, index) => {
                  const answer = answers[question.level];
                  if (answer === undefined && index !== currentIndex) return null;
                  const active = index === currentIndex;
                  return (
                    <div className={`nli-question ${active ? "active" : "answered"}`} key={question.level}>
                      <span className="nli-question-level">{question.level}</span>
                      <div><strong>{question.question}</strong><small>{question.explanation}</small></div>
                      {active ? (
                        <div className="nli-binary-actions">
                          <button onClick={() => setAnswers((value) => ({ ...value, [question.level]: false }))}>Não</button>
                          <button className="yes" onClick={() => setAnswers((value) => ({ ...value, [question.level]: true }))}>Sim</button>
                        </div>
                      ) : (
                        <span className={`nli-answer ${answer ? "yes" : "no"}`}>{answer ? "Sim" : "Não"}</span>
                      )}
                    </div>
                  );
                })}
                {level === "N1" && (
                  <div className="nli-question n1-result">
                    <span className="nli-question-level">N1</span>
                    <div><strong>Preconceito implícito ou velado</strong><small>Resultado após quatro respostas “não”.</small></div>
                    <span className="nli-answer yes">Resultado</span>
                  </div>
                )}
              </div>
              <button className="nli-reset-layer" onClick={() => setAnswers({})}>
                <RotateCcw size={14} />Refazer sequência
              </button>
            </section>

            <section className={`nli-layer-card ${!level ? "locked" : ""}`}>
              <header>
                <div className="nli-layer-number">4</div>
                <div><span className="section-label">CAMADA 4</span><h2>Revisar dimensões</h2></div>
              </header>
              {level && (
                <div className="nli-dimension-grid">
                  {NLI_LAYER4_DIMENSIONS.map((dimension) => {
                    const checked = dimensions.includes(dimension.code);
                    return (
                      <button
                        key={dimension.code}
                        className={checked ? "selected" : ""}
                        aria-pressed={checked}
                        onClick={() => setDimensions((current) =>
                          checked
                            ? current.filter((code) => code !== dimension.code)
                            : [...current, dimension.code],
                        )}
                      >
                        <span className="nli-dimension-check">{checked && <Check size={15} />}</span>
                        <span><strong>{dimension.name}</strong><small>{dimension.description}</small></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
            <label className="note-field">
              Observação <span>(opcional)</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
            </label>
            <button className="save-correction" disabled={!level || saving} onClick={() => void save()}>
              <Check size={18} />{saving ? "Salvando..." : "Salvar alteração NLI"}
            </button>
          </div>
        ) : (
          <>
            <form className="history-search" onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(searchInput.trim());
            }}>
              <label><Search size={17} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por texto ou ID" /></label>
              <button type="submit">Buscar</button>
            </form>
            <div className="history-summary"><strong>{number(total)} avaliações NLI</strong></div>
            {loading ? (
              <div className="history-loading">Carregando histórico NLI...</div>
            ) : rows.length === 0 ? (
              <div className="history-empty"><Layers3 size={27} /><strong>Nenhuma avaliação NLI encontrada</strong></div>
            ) : (
              <div className="history-list nli-history-list">
                {rows.map((entry) => (
                  <article key={entry.nliReviewId}>
                    <div className="history-item-top">
                      <span className={`platform-chip ${entry.platform}`}>{PLATFORM_NAMES[entry.platform] || entry.platform}</span>
                      <strong>{entry.layer3Level}</strong>
                      <time>{new Date(entry.reviewedAt).toLocaleString("pt-BR")}</time>
                    </div>
                    <p>{entry.text}</p>
                    <div className="history-item-bottom">
                      <span>{entry.layer4Dimensions.length} dimensão(ões)</span>
                      <button onClick={() => edit(entry)}><Edit3 size={15} />Revisar NLI</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="history-pagination">
              <button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} />Anterior</button>
              <span>Página {page} de {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima<ChevronRight size={16} /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function OriginContext({
  originPost,
  parentComment,
}: {
  originPost: OriginPost | null;
  parentComment: ParentComment | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const postBody = originPost
    ? [
        originPost.title,
        originPost.text && originPost.text !== originPost.title
          ? originPost.text
          : null,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  const longContext =
    postBody.length > 650 || (parentComment?.text.length || 0) > 420;

  if (!originPost && !parentComment) {
    return (
      <section className="origin-context unavailable">
        <div className="origin-context-heading">
          <FileText size={17} />
          <div>
            <strong>Contexto da publicação</strong>
            <span>Post de origem não disponível na coleta.</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`origin-context ${expanded ? "expanded" : ""}`}>
      <div className="origin-context-heading">
        <FileText size={17} />
        <div>
          <strong>Contexto da publicação</strong>
          <span>
            Leia o post original antes de classificar o comentário.
          </span>
        </div>
        {originPost?.url && (
          <a href={originPost.url} target="_blank" rel="noreferrer">
            Abrir original
          </a>
        )}
      </div>

      {originPost && (
        <div className="origin-post">
          <div className="origin-context-meta">
            <span>POST DE ORIGEM</span>
            {originPost.author && <span>Por {originPost.author}</span>}
            {originPost.publishedAt && (
              <time>
                {new Date(originPost.publishedAt).toLocaleString("pt-BR")}
              </time>
            )}
            <span>ID {originPost.externalId}</span>
          </div>
          <div className="origin-context-text">
            {postBody || "A publicação não possui texto armazenado."}
          </div>
        </div>
      )}

      {parentComment && (
        <div className="parent-comment-context">
          <div className="origin-context-meta">
            <span>COMENTÁRIO ANTERIOR NA CONVERSA</span>
            {parentComment.author && <span>Por {parentComment.author}</span>}
            {parentComment.publishedAt && (
              <time>
                {new Date(parentComment.publishedAt).toLocaleString("pt-BR")}
              </time>
            )}
          </div>
          <div className="origin-context-text">{parentComment.text}</div>
        </div>
      )}

      {longContext && (
        <button
          className="origin-expand-button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {expanded ? "Recolher contexto" : "Ler contexto completo"}
        </button>
      )}
    </section>
  );
}

function ReviewHistoryPanel({
  categories,
  close,
  onUpdated,
}: {
  categories: Category[];
  close: () => void;
  onUpdated: () => void;
}) {
  const [data, setData] = useState<ReviewHistoryResponse | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReviewHistoryEntry | null>(null);
  const [finalLabel, setFinalLabel] = useState<"hate" | "nao_hate">(
    "nao_hate",
  );
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "15",
      });
      if (search) params.set("search", search);
      const response = await fetch(`/api/reviews/history?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível carregar o histórico.");
      }
      setData(body);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao carregar histórico.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadHistory(), 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  function edit(entry: ReviewHistoryEntry) {
    setSelected(entry);
    setFinalLabel(entry.finalLabel);
    setSelectedTypes(
      entry.finalLabel === "hate" ? entry.finalHateTypes : [],
    );
    setNote(entry.note || "");
    setError("");
  }

  async function saveRevision() {
    if (!selected || saving) return;
    if (finalLabel === "hate" && selectedTypes.length === 0) {
      setError("Selecione ao menos um tipo para salvar como hate.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/reviews/${selected.analysisId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finalLabel,
          finalHateTypes: finalLabel === "hate" ? selectedTypes : [],
          note,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível atualizar a avaliação.");
      }
      setSelected(null);
      await loadHistory();
      onUpdated();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao salvar alteração.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="history-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="history-panel">
        <header className="history-heading">
          <div>
            <span className="eyebrow">HISTÓRICO INDIVIDUAL</span>
            <h2 id="history-title">Minhas avaliações</h2>
            <p>
              Consulte o que você já avaliou e corrija uma decisão quando
              necessário.
            </p>
          </div>
          <button onClick={close} aria-label="Fechar histórico">
            <X size={20} />
          </button>
        </header>

        {error && (
          <div className="workspace-error" role="alert">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {selected ? (
          <div className="history-editor">
            <button
              className="history-back-button"
              onClick={() => setSelected(null)}
            >
              <ChevronLeft size={17} />
              Voltar ao histórico
            </button>
            <div className="history-review-context">
              <div className="history-review-meta">
                <span className={`platform-chip ${selected.platform}`}>
                  {PLATFORM_NAMES[selected.platform] || selected.platform}
                </span>
                <span>{TYPE_LABELS[selected.contentKind]}</span>
                <span>#{selected.analysisId}</span>
                <time>
                  Avaliado em{" "}
                  {new Date(selected.reviewedAt).toLocaleString("pt-BR")}
                </time>
              </div>
              {selected.contentKind === "comment" && (
                <OriginContext
                  key={selected.analysisId}
                  originPost={selected.originPost}
                  parentComment={selected.parentComment}
                />
              )}
              <span className="section-label">CONTEÚDO AVALIADO</span>
              <div className="history-full-text">{selected.text}</div>
            </div>
            <CorrectionPanel
              categories={categories}
              finalLabel={finalLabel}
              setFinalLabel={setFinalLabel}
              selectedTypes={selectedTypes}
              setSelectedTypes={setSelectedTypes}
              note={note}
              setNote={setNote}
              gemmaLabel={selected.gemmaLabel}
              gemmaHateTypes={selected.hateTypes}
              close={() => setSelected(null)}
              save={saveRevision}
              submitting={saving}
              title="Revise sua decisão anterior"
              saveLabel="Salvar alteração no histórico"
            />
          </div>
        ) : (
          <>
            <form
              className="history-search"
              onSubmit={(event) => {
                event.preventDefault();
                setPage(1);
                setSearch(searchInput.trim());
              }}
            >
              <label>
                <Search size={17} />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Buscar por texto, ID da análise ou ID de origem"
                />
              </label>
              <button type="submit">Buscar</button>
              {search && (
                <button
                  type="button"
                  className="history-clear-search"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                >
                  Limpar
                </button>
              )}
            </form>

            <div className="history-summary">
              <span>
                {loading
                  ? "Carregando avaliações..."
                  : `${number(data?.total || 0)} avaliação(ões) encontrada(s)`}
              </span>
              <small>
                As alterações ficam registradas no histórico de auditoria.
              </small>
            </div>

            {loading ? (
              <div className="history-loading">
                <RotateCcw className="spin" size={24} />
                Carregando seu histórico...
              </div>
            ) : !data?.rows.length ? (
              <div className="history-empty">
                <History size={34} />
                <strong>Nenhuma avaliação encontrada</strong>
                <span>
                  {search
                    ? "Tente buscar por outro trecho ou número."
                    : "Suas avaliações concluídas aparecerão aqui."}
                </span>
              </div>
            ) : (
              <div className="history-list">
                {data.rows.map((entry) => (
                  <article key={entry.reviewId}>
                    <div className="history-item-top">
                      <span className={`platform-chip ${entry.platform}`}>
                        {PLATFORM_NAMES[entry.platform] || entry.platform}
                      </span>
                      <span>{TYPE_LABELS[entry.contentKind]}</span>
                      <span>#{entry.analysisId}</span>
                      <time>
                        {new Date(entry.reviewedAt).toLocaleString("pt-BR")}
                      </time>
                    </div>
                    <p>{entry.text}</p>
                    <div className="history-item-bottom">
                      <span
                        className={`history-decision ${entry.finalLabel}`}
                      >
                        Sua decisão:{" "}
                        {entry.finalLabel === "hate" ? "HATE" : "NÃO HATE"}
                      </span>
                      <button onClick={() => edit(entry)}>
                        <Edit3 size={16} />
                        Rever e corrigir
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {data && data.totalPages > 1 && (
              <div className="history-pagination">
                <button
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || loading}
                  aria-label="Página anterior do histórico"
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  Página {data.page} de {data.totalPages}
                </span>
                <button
                  onClick={() =>
                    setPage((value) =>
                      Math.min(data.totalPages, value + 1),
                    )
                  }
                  disabled={page >= data.totalPages || loading}
                  aria-label="Próxima página do histórico"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function LabelingGuide({
  categories,
  close,
}: {
  categories: Category[];
  close: () => void;
}) {
  return (
    <div
      className="guide-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="guide-panel">
        <header>
          <div>
            <span className="eyebrow">PADRÃO DE ANOTAÇÃO</span>
            <h2>Guia de rotulagem</h2>
            <p>
              Use os mesmos critérios em todas as redes e registre mais de um
              tipo quando o texto atacar múltiplos grupos.
            </p>
          </div>
          <button onClick={close} aria-label="Fechar guia">
            <X size={20} />
          </button>
        </header>

        <div className="guide-principles">
          <article>
            <strong>Marque HATE</strong>
            <p>
              Quando houver ataque, inferiorização, exclusão, ameaça ou
              generalização hostil contra um grupo social identificável.
            </p>
          </article>
          <article>
            <strong>Marque NÃO HATE</strong>
            <p>
              Crítica a uma pessoa, instituição, opinião ou comportamento sem
              ataque generalizado ao grupo.
            </p>
          </article>
          <article>
            <strong>Considere o contexto</strong>
            <p>
              Citação, denúncia, ironia e reprodução jornalística não devem ser
              tratadas automaticamente como concordância com o ataque.
            </p>
          </article>
        </div>

        <div className="guide-categories">
          {categories.map((category) => (
            <article key={category.code}>
              <div>
                <strong>{category.name}</strong>
                <code>{category.code}</code>
              </div>
              <p>{category.description}</p>
              {category.positiveExample && (
                <blockquote>
                  <span>Exemplo positivo</span>
                  {category.positiveExample}
                </blockquote>
              )}
              {category.boundaryExample && (
                <small>
                  <b>Limite:</b> {category.boundaryExample}
                </small>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminPanel({ close }: { close: () => void }) {
  const [activeTab, setActiveTab] = useState<
    "metrics" | "data" | "nli" | "workflow" | "users"
  >("metrics");
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"reviewer" | "admin">("reviewer");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [credential, setCredential] = useState<{
    username: string;
    password: string;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar os usuários.");
      }
      setUsers(data.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError("");
    try {
      const response = await fetch("/api/admin/metrics");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar as métricas.");
      }
      setMetrics(data);
    } catch (cause) {
      setMetricsError(
        cause instanceof Error ? cause.message : "Falha ao carregar métricas.",
      );
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadUsers(), loadMetrics()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMetrics, loadUsers]);

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setCredential(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, role }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível criar o usuário.");
      }
      setCredential({
        username: data.user.username,
        password: data.temporaryPassword,
      });
      setDisplayName("");
      setUsername("");
      setRole("reviewer");
      await loadUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function copyCredential() {
    if (!credential) return;
    await navigator.clipboard.writeText(
      `Usuário: ${credential.username}\nSenha temporária: ${credential.password}`,
    );
  }

  return (
    <div
      className="admin-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="admin-panel">
        <div className="admin-sticky-header">
          <header className="admin-heading">
            <div>
              <span className="eyebrow">ADMINISTRAÇÃO</span>
              <h2>Painel administrativo</h2>
              <p>Acompanhe o dataset, avalie o modelo e gerencie a equipe.</p>
            </div>
            <button className="close-admin" onClick={close} aria-label="Fechar">
              <X size={20} />
            </button>
          </header>

          <nav className="admin-tabs" aria-label="Seções administrativas">
            <button
              className={activeTab === "metrics" ? "active" : ""}
              onClick={() => setActiveTab("metrics")}
            >
              <BarChart3 size={17} />Métricas
            </button>
            <button
              className={activeTab === "data" ? "active" : ""}
              onClick={() => setActiveTab("data")}
            >
              <Table2 size={17} />Dados do Gemma
            </button>
            <button
              className={activeTab === "nli" ? "active" : ""}
              onClick={() => setActiveTab("nli")}
            >
              <BrainCircuit size={17} />Visão NLI
            </button>
            <button
              className={activeTab === "workflow" ? "active" : ""}
              onClick={() => setActiveTab("workflow")}
            >
              <Layers3 size={17} />Fluxo do gold
            </button>
            <button
              className={activeTab === "users" ? "active" : ""}
              onClick={() => setActiveTab("users")}
            >
              <Users size={17} />Usuários
            </button>
          </nav>
        </div>

        {activeTab === "metrics" ? (
          <AdminMetricsView
            metrics={metrics}
            loading={metricsLoading}
            error={metricsError}
            reload={loadMetrics}
          />
        ) : activeTab === "data" ? (
          <GemmaDataView />
        ) : activeTab === "nli" ? (
          <AdminNliDataView />
        ) : activeTab === "workflow" ? (
          <WorkflowAdminView onUsersChanged={loadUsers} />
        ) : (
          <div className="admin-grid">
          <form className="new-user-form" onSubmit={createUser}>
            <div className="admin-section-title">
              <UserPlus size={19} />
              <strong>Novo usuário</strong>
            </div>
            <label>
              Nome completo
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Nome do avaliador"
                required
              />
            </label>
            <label>
              Usuário
              <input
                value={username}
                onChange={(event) =>
                  setUsername(event.target.value.toLowerCase().replace(/\s/g, ""))
                }
                placeholder="nome.sobrenome"
                autoCapitalize="none"
                required
              />
            </label>
            <label>
              Perfil
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value === "admin" ? "admin" : "reviewer")
                }
              >
                <option value="reviewer">Avaliador</option>
                <option value="admin">Administrador</option>
              </select>
            </label>
            <button className="primary-button" disabled={saving}>
              {saving ? "Criando..." : "Criar conta"}
            </button>
            <small>
              O sistema gera uma senha temporária e exige a troca no primeiro
              acesso.
            </small>
          </form>

          <section className="users-section">
            <div className="admin-section-title">
              <Users size={19} />
              <strong>Contas cadastradas</strong>
              <span>{users.length}</span>
            </div>

            {credential && (
              <div className="temporary-credential">
                <div>
                  <strong>Conta criada — copie agora</strong>
                  <span>Usuário: {credential.username}</span>
                  <span>Senha: {credential.password}</span>
                </div>
                <button onClick={copyCredential} title="Copiar acesso">
                  <Copy size={17} />
                </button>
              </div>
            )}

            {error && (
              <div className="form-error" role="alert">
                <AlertCircle size={17} />{error}
              </div>
            )}

            <div className="user-list">
              {loading ? (
                <p className="admin-muted">Carregando usuários...</p>
              ) : (
                users.map((user) => (
                  <article className="user-row" key={user.reviewerId}>
                    <div className="user-avatar">
                      {user.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="user-details">
                      <strong>{user.displayName}</strong>
                      <span>
                        @{user.username} · {number(user.reviewedCount)} revisões
                      </span>
                    </div>
                    <div className="user-status">
                      <em className={user.role}>{user.role === "admin" ? "Admin" : "Avaliador"}</em>
                      <small>
                        {user.doubleReviewEnabled
                          ? "Revisão dupla"
                          : user.mustChangePassword
                            ? "Senha temporária"
                            : "Ativo"}
                      </small>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
          </div>
        )}
      </section>
    </div>
  );
}

function WorkflowAdminView({
  onUsersChanged,
}: {
  onUsersChanged: () => void;
}) {
  const [workflow, setWorkflow] = useState<WorkflowOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [batchName, setBatchName] = useState(
    `Lote balanceado ${new Date().toLocaleDateString("pt-BR")}`,
  );
  const [batchSize, setBatchSize] = useState(500);
  const [doublePercent, setDoublePercent] = useState(20);

  const loadWorkflow = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/workflow");
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível carregar o fluxo.");
      }
      setWorkflow(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkflow(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkflow]);

  async function toggleDoubleReviewer(reviewerId: number, enabled: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewerId,
          doubleReviewEnabled: enabled,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível alterar o avaliador.");
      }
      setWorkflow((current) =>
        current
          ? {
              ...current,
              reviewers: current.reviewers.map((reviewer) =>
                reviewer.reviewerId === reviewerId
                  ? { ...reviewer, doubleReviewEnabled: enabled }
                  : reviewer,
              ),
            }
          : current,
      );
      void onUsersChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function createBatch(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_batch",
          name: batchName,
          size: batchSize,
          doubleReviewPercent: doublePercent,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível criar o lote.");
      }
      setNotice(
        `Lote criado com ${number(data.selectedSize)} itens; ${number(data.doubleReviewItems)} terão duas avaliações.`,
      );
      await loadWorkflow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar lote.");
    } finally {
      setSaving(false);
    }
  }

  async function resolveConflict(analysisId: number, reviewId: number) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve_conflict",
          analysisId,
          reviewId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Não foi possível resolver o conflito.");
      }
      setNotice(`Conflito da análise #${analysisId} resolvido.`);
      await loadWorkflow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao resolver.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !workflow) {
    return (
      <div className="workflow-loading">
        <div className="pulse-line wide" />
        <div className="metrics-loading-panel" />
      </div>
    );
  }
  if (!workflow) {
    return (
      <div className="metrics-error">
        <AlertCircle size={22} />
        <div>
          <strong>Fluxo indisponível</strong>
          <span>{error}</span>
        </div>
        <button onClick={loadWorkflow}>Tentar novamente</button>
      </div>
    );
  }

  const enabledReviewers = workflow.reviewers.filter(
    (reviewer) => reviewer.doubleReviewEnabled,
  ).length;
  const remainingToSample = workflow.platformCoverage.reduce(
    (total, platform) => total + platform.remainingToSample,
    0,
  );
  const auditLabels: Record<string, string> = {
    assigned: "Item atribuído",
    decision_submitted: "Decisão registrada",
    skipped: "Item pulado",
    conflict_adjudicated: "Conflito decidido pelo admin",
    historical_import: "Revisão anterior importada",
  };

  return (
    <div className="workflow-dashboard">
      <div className="workflow-heading">
        <div>
          <Layers3 size={21} />
          <span>
            <strong>Construção controlada do dataset gold</strong>
            <small>
              {workflow.inference.model} · {workflow.inference.promptVersion}
            </small>
          </span>
        </div>
        <button onClick={loadWorkflow} disabled={loading}>
          <RotateCcw size={15} />
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error && (
        <div className="metrics-inline-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="workflow-notice">
          <Check size={16} />
          {notice}
        </div>
      )}

      <section className="workflow-section">
        <div className="metrics-section-heading">
          <div>
            <Database size={19} />
            <span>
              <strong>Gestão de duplicatas exatas</strong>
              <small>
                Um texto é revisado uma vez e a decisão vale para cópias com o
                mesmo hash
              </small>
            </span>
          </div>
        </div>
        <div className="workflow-stat-grid">
          <MetricCard
            icon={<FileText size={18} />}
            label="Textos únicos"
            value={number(workflow.duplicates.uniqueTexts)}
            note={`${number(workflow.duplicates.mappedAnalyses)} análises mapeadas`}
          />
          <MetricCard
            icon={<Copy size={18} />}
            label="Registros duplicados"
            value={number(workflow.duplicates.duplicateRecords)}
            note={`${number(workflow.duplicates.duplicateGroups)} grupos exatos`}
          />
          <MetricCard
            icon={<ShieldCheck size={18} />}
            label="Decisões reaproveitadas"
            value={number(workflow.duplicates.decisionsReused)}
            note="Sem repetir a avaliação humana"
            tone="teal"
          />
        </div>
      </section>

      <section className="workflow-section">
        <div className="metrics-section-heading">
          <div>
            <Target size={19} />
            <span>
              <strong>
                Cobertura equilibrada por rede social
              </strong>
              <small>
                Meta dinâmica de {workflow.platformCoverageTargetPercent}% do
                conteúdo único de cada rede
              </small>
            </span>
          </div>
          <em>
            {number(remainingToSample)} ainda precisam entrar na amostra
          </em>
        </div>
        <p className="coverage-explanation">
          A meta é recalculada quando novos dados chegam. A fila e os novos
          lotes priorizam automaticamente as redes mais distantes dos{" "}
          {workflow.platformCoverageTargetPercent}%.
        </p>
        <div className="metrics-table-wrap">
          <table className="metrics-table coverage-table">
            <thead>
              <tr>
                <th>Rede social</th>
                <th>Disponíveis</th>
                <th>Meta</th>
                <th>Na amostra</th>
                <th>Avaliados</th>
                <th>Avanço da meta</th>
              </tr>
            </thead>
            <tbody>
              {workflow.platformCoverage.map((platform) => (
                <tr key={platform.platform}>
                  <td>
                    <span
                      className={`platform-dot ${platform.platform}`}
                    />
                    {PLATFORM_NAMES[platform.platform] || platform.platform}
                  </td>
                  <td>{number(platform.total)}</td>
                  <td>
                    <strong>{number(platform.target)}</strong>
                    <small>
                      {workflow.platformCoverageTargetPercent}% da rede
                    </small>
                  </td>
                  <td>{number(platform.sampled)}</td>
                  <td>{number(platform.reviewed)}</td>
                  <td>
                    <div className="table-progress">
                      <span>
                        <i
                          style={{
                            width: `${platform.targetProgress * 100}%`,
                          }}
                        />
                      </span>
                      <em>{metricPercent(platform.targetProgress)}</em>
                    </div>
                    <small>
                      Faltam {number(platform.remainingToReview)}
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="workflow-two-columns">
        <section className="workflow-section">
          <div className="metrics-section-heading">
            <div>
              <GitCompareArrows size={19} />
              <span>
                <strong>Avaliadores da revisão dupla</strong>
                <small>
                  Somente os selecionados recebem itens que exigem duas decisões
                </small>
              </span>
            </div>
            <em>{enabledReviewers} selecionados</em>
          </div>
          <div className="double-reviewer-list">
            {workflow.reviewers.map((reviewer) => (
              <label key={reviewer.reviewerId}>
                <input
                  type="checkbox"
                  checked={reviewer.doubleReviewEnabled}
                  disabled={saving}
                  onChange={(event) =>
                    void toggleDoubleReviewer(
                      reviewer.reviewerId,
                      event.target.checked,
                    )
                  }
                />
                <span>
                  <strong>{reviewer.displayName}</strong>
                  <small>
                    @{reviewer.username} · {number(reviewer.secondReviews)}{" "}
                    segundas revisões
                  </small>
                </span>
                <em>{reviewer.role === "admin" ? "Admin" : "Avaliador"}</em>
              </label>
            ))}
          </div>
        </section>

        <form className="workflow-section batch-form" onSubmit={createBatch}>
          <div className="metrics-section-heading">
            <div>
              <Target size={19} />
              <span>
                <strong>Novo lote balanceado</strong>
                <small>
                  Distribuição por rede, rótulo e tipo de discurso de ódio
                </small>
              </span>
            </div>
          </div>
          <label>
            Nome do lote
            <input
              value={batchName}
              maxLength={120}
              onChange={(event) => setBatchName(event.target.value)}
              required
            />
          </label>
          <div>
            <label>
              Quantidade de textos
              <input
                type="number"
                min={1}
                max={10000}
                value={batchSize}
                onChange={(event) => setBatchSize(Number(event.target.value))}
                required
              />
            </label>
            <label>
              Amostra com revisão dupla
              <select
                value={doublePercent}
                onChange={(event) =>
                  setDoublePercent(Number(event.target.value))
                }
              >
                <option value={0}>0%</option>
                <option value={10}>10%</option>
                <option value={20}>20%</option>
                <option value={30}>30%</option>
                <option value={50}>50%</option>
                <option value={100}>100%</option>
              </select>
            </label>
          </div>
          <button className="primary-button" disabled={saving}>
            {saving ? "Criando lote..." : "Criar lote balanceado"}
          </button>
          <small>
            O sistema começa pelos estratos menos representados. Para revisão
            dupla, selecione pelo menos dois avaliadores.
          </small>
        </form>
      </div>

      <section className="workflow-section">
        <div className="metrics-section-heading">
          <div>
            <BarChart3 size={19} />
            <span>
              <strong>Lotes criados</strong>
              <small>Cobertura e situação de cada amostra</small>
            </span>
          </div>
        </div>
        {workflow.batches.length ? (
          <div className="metrics-table-wrap">
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Lote</th>
                  <th>Selecionados</th>
                  <th>Revisão dupla</th>
                  <th>Resolvidos</th>
                  <th>Aguardando 2ª</th>
                  <th>Conflitos</th>
                </tr>
              </thead>
              <tbody>
                {workflow.batches.map((batch) => (
                  <tr key={batch.batchId}>
                    <td>
                      <strong>{batch.name}</strong>
                      <small>
                        {new Date(batch.createdAt).toLocaleString("pt-BR")}
                      </small>
                    </td>
                    <td>{number(batch.selectedSize)}</td>
                    <td>{batch.doubleReviewPercent}%</td>
                    <td>{number(batch.resolvedItems)}</td>
                    <td>{number(batch.awaitingSecond)}</td>
                    <td>{number(batch.conflictItems)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="metrics-empty spacious">
            Nenhum lote balanceado foi criado ainda.
          </p>
        )}
      </section>

      <section className="workflow-section">
        <div className="metrics-section-heading">
          <div>
            <GitCompareArrows size={19} />
            <span>
              <strong>Conflitos para decisão do administrador</strong>
              <small>
                Escolha a classificação final quando os dois especialistas
                discordarem
              </small>
            </span>
          </div>
          <em>{workflow.conflicts.length} pendentes</em>
        </div>
        {workflow.conflicts.length ? (
          <div className="conflict-list">
            {workflow.conflicts.map((conflict) => (
              <article key={conflict.analysisId}>
                <header>
                  <span className={`gemma-platform ${conflict.platform}`}>
                    {conflict.platform}
                  </span>
                  <strong>#{conflict.analysisId}</strong>
                  <small>
                    Gemma: {conflict.gemmaLabel === "hate" ? "HATE" : "NÃO HATE"}
                  </small>
                </header>
                <p>{conflict.text}</p>
                <div>
                  {conflict.reviews.map((review) => (
                    <button
                      key={review.reviewId}
                      disabled={saving}
                      onClick={() =>
                        void resolveConflict(
                          conflict.analysisId,
                          review.reviewId,
                        )
                      }
                    >
                      <span>
                        <strong>{review.reviewerName}</strong>
                        <small>@{review.reviewerUsername}</small>
                      </span>
                      <em className={review.finalLabel}>
                        {review.finalLabel === "hate" ? "HATE" : "NÃO HATE"}
                      </em>
                      <small>
                        {review.finalHateTypes.join(", ") || "Sem tipos"}
                      </small>
                      <b>Usar esta decisão</b>
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="metrics-empty spacious">
            Não há conflitos pendentes de adjudicação.
          </p>
        )}
      </section>

      <section className="workflow-section">
        <div className="metrics-section-heading">
          <div>
            <History size={19} />
            <span>
              <strong>Histórico e auditoria</strong>
              <small>
                Predição original, responsável, decisão e horário de cada ação
              </small>
            </span>
          </div>
        </div>
        <div className="audit-list">
          {workflow.audit.map((entry) => (
            <article key={entry.auditId}>
              <span className={`gemma-platform ${entry.platform}`}>
                {entry.platform}
              </span>
              <div>
                <strong>
                  {auditLabels[entry.eventType] || entry.eventType} · #
                  {entry.analysisId}
                </strong>
                <p>{entry.textPreview}</p>
                <small>
                  Gemma: {entry.gemmaLabel || "—"} ·{" "}
                  {entry.actorName || "Sistema"}{" "}
                  {entry.actorUsername ? `(@${entry.actorUsername})` : ""} ·{" "}
                  {new Date(entry.createdAt).toLocaleString("pt-BR")}
                </small>
              </div>
              <code>
                {entry.newValue?.finalLabel
                  ? String(entry.newValue.finalLabel)
                  : entry.eventType}
              </code>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminNliDataView() {
  const [data, setData] = useState<AdminNliResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [dimension, setDimension] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [detail, setDetail] = useState<AdminNliRow | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (search) params.set("search", search);
        if (platform) params.set("platform", platform);
        if (status) params.set("status", status);
        if (level) params.set("level", level);
        if (dimension) params.set("dimension", dimension);
        if (reviewerId) params.set("reviewerId", reviewerId);
        const response = await fetch(`/api/admin/nli-data?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "Não foi possível carregar os dados NLI.");
        }
        setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Falha ao carregar NLI.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    dimension,
    level,
    page,
    pageSize,
    platform,
    refreshToken,
    reviewerId,
    search,
    status,
  ]);

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function clearFilters() {
    setDraftSearch("");
    setSearch("");
    setPlatform("");
    setStatus("");
    setLevel("");
    setDimension("");
    setReviewerId("");
    setPage(1);
  }

  const statusNames: Record<string, string> = {
    assigned: "Em avaliação",
    completed: "Concluído",
    skipped: "Pulado",
    invalidated: "Invalidado",
  };
  const dimensionNames = Object.fromEntries(
    NLI_LAYER4_DIMENSIONS.map((entry) => [entry.code, entry.name]),
  );
  dimensionNames.masculinism = "Dominância Social";
  const hasFilters = Boolean(
    search || platform || status || level || dimension || reviewerId,
  );

  return (
    <section className="gemma-data-view nli-admin-data-view">
      <header className="gemma-data-heading nli-data-heading">
        <div>
          <BrainCircuit size={20} />
          <span>
            <strong>Visão completa das avaliações NLI</strong>
            <small>
              Consulte gravidade, respostas, dimensões, avaliadores e saídas do modelo.
            </small>
          </span>
        </div>
        <div className="gemma-data-total">
          <strong>{number(data?.total || 0)}</strong>
          <span>registros NLI</span>
        </div>
      </header>

      <form
        className="gemma-search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSearch(draftSearch.trim());
        }}
      >
        <label>
          <Search size={16} />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Buscar por texto, análise, ID externo ou avaliador"
          />
        </label>
        <button type="submit">Buscar</button>
        <button
          className="gemma-refresh"
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          title="Atualizar dados NLI"
        >
          <RotateCcw size={16} />
        </button>
      </form>

      <div className="gemma-filters nli-data-filters">
        <select
          value={platform}
          onChange={(event) => changeFilter(setPlatform, event.target.value)}
          aria-label="Filtrar NLI por rede social"
        >
          <option value="">Todas as redes</option>
          {PLATFORMS.slice(1).map(([value, name]) => (
            <option value={value} key={value}>{name}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => changeFilter(setStatus, event.target.value)}
          aria-label="Filtrar NLI por status"
        >
          <option value="">Todos os status</option>
          <option value="completed">Concluídos</option>
          <option value="assigned">Em avaliação</option>
          <option value="skipped">Pulados</option>
          <option value="invalidated">Invalidados</option>
        </select>
        <select
          value={level}
          onChange={(event) => changeFilter(setLevel, event.target.value)}
          aria-label="Filtrar por nível da Camada 3"
        >
          <option value="">Todos os níveis</option>
          {["N1", "N2", "N3", "N4", "N5"].map((entry) => (
            <option value={entry} key={entry}>{entry}</option>
          ))}
        </select>
        <select
          value={dimension}
          onChange={(event) => changeFilter(setDimension, event.target.value)}
          aria-label="Filtrar por dimensão da Camada 4"
        >
          <option value="">Todas as dimensões</option>
          {NLI_LAYER4_DIMENSIONS.map((entry) => (
            <option value={entry.code} key={entry.code}>{entry.name}</option>
          ))}
        </select>
        <select
          value={reviewerId}
          onChange={(event) => changeFilter(setReviewerId, event.target.value)}
          aria-label="Filtrar NLI por avaliador"
        >
          <option value="">Todos os avaliadores</option>
          {(data?.filters.reviewers || []).map((reviewer) => (
            <option value={reviewer.reviewerId} key={reviewer.reviewerId}>
              {reviewer.name}
            </option>
          ))}
        </select>
        {hasFilters && <button type="button" onClick={clearFilters}>Limpar filtros</button>}
      </div>

      {error && (
        <div className="metrics-inline-error"><AlertCircle size={16} />{error}</div>
      )}

      <div className={`gemma-table-shell ${loading ? "loading" : ""}`}>
        <table className="gemma-table nli-admin-table">
          <thead>
            <tr>
              <th>Análise</th>
              <th>Rede</th>
              <th>Conteúdo</th>
              <th>Status</th>
              <th>Camada 3</th>
              <th>Camada 4</th>
              <th>Avaliador</th>
              <th>Data</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && data?.rows.length === 0 ? (
              <tr>
                <td className="gemma-empty-row" colSpan={9}>
                  Nenhuma avaliação NLI encontrada para estes filtros.
                </td>
              </tr>
            ) : (
              (data?.rows || []).map((row) => (
                <tr key={row.nliReviewId}>
                  <td><strong>#{row.analysisId}</strong><small>NLI #{row.nliReviewId}</small></td>
                  <td>
                    <span className={`gemma-platform ${row.platform}`}>
                      {PLATFORM_NAMES[row.platform] || row.platform}
                    </span>
                  </td>
                  <td className="gemma-text-cell">
                    <strong>{row.text}</strong>
                    <small>{TYPE_LABELS[row.contentKind]} · {row.externalId}</small>
                  </td>
                  <td>
                    <span className={`nli-admin-status ${row.status}`}>
                      {statusNames[row.status] || row.status}
                    </span>
                    <small>Gold: {row.gold.label || "—"}</small>
                  </td>
                  <td>
                    {row.layer3Level ? (
                      <span className={`nli-table-level ${row.layer3Level.toLowerCase()}`}>
                        {row.layer3Level}
                      </span>
                    ) : "—"}
                  </td>
                  <td>
                    <div className="gemma-type-list">
                      {row.layer4Dimensions.length
                        ? row.layer4Dimensions.slice(0, 2).map((entry) => (
                            <span key={entry}>{dimensionNames[entry] || entry}</span>
                          ))
                        : row.status === "completed" ? "Nenhuma" : "—"}
                      {row.layer4Dimensions.length > 2 && (
                        <em>+{row.layer4Dimensions.length - 2}</em>
                      )}
                    </div>
                  </td>
                  <td className="nli-reviewer-cell">
                    <strong>{row.reviewer.name}</strong>
                    <small>@{row.reviewer.username}</small>
                  </td>
                  <td>
                    {new Date(row.reviewedAt || row.assignedAt).toLocaleDateString("pt-BR")}
                    <small>{row.reviewedAt ? "Concluído" : "Reservado"}</small>
                  </td>
                  <td>
                    <button
                      className="gemma-view-button"
                      onClick={() => setDetail(row)}
                      title={`Ver NLI da análise ${row.analysisId}`}
                      aria-label={`Ver NLI da análise ${row.analysisId}`}
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {loading && (
          <div className="gemma-table-loading">
            <RotateCcw size={22} />Carregando avaliações NLI...
          </div>
        )}
      </div>

      <footer className="gemma-pagination">
        <label>
          Por página
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <span>Página <strong>{data?.page || page}</strong> de <strong>{number(data?.totalPages || 1)}</strong></span>
        <div>
          <button disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Página NLI anterior"><ChevronLeft size={17} /></button>
          <button disabled={loading || page >= (data?.totalPages || 1)} onClick={() => setPage((value) => value + 1)} aria-label="Próxima página NLI"><ChevronRight size={17} /></button>
        </div>
      </footer>

      {detail && (
        <AdminNliDetailPanel
          detail={detail}
          dimensionNames={dimensionNames}
          close={() => setDetail(null)}
        />
      )}
    </section>
  );
}

function AdminNliDetailPanel({
  detail,
  dimensionNames,
  close,
}: {
  detail: AdminNliRow;
  dimensionNames: Record<string, string>;
  close: () => void;
}) {
  const statusNames: Record<string, string> = {
    assigned: "Em avaliação",
    completed: "Concluído",
    skipped: "Pulado",
    invalidated: "Invalidado",
  };
  return (
    <div className="gemma-detail-overlay" role="dialog" aria-modal="true" aria-label={`Detalhes NLI da análise ${detail.analysisId}`}>
      <aside className="gemma-detail-panel nli-admin-detail">
        <header>
          <div>
            <span className="eyebrow">REGISTRO NLI COMPLETO</span>
            <h3>Análise #{detail.analysisId}</h3>
          </div>
          <button onClick={close} aria-label="Fechar detalhes NLI"><X size={19} /></button>
        </header>
        <div className="gemma-detail-content">
          <div className="gemma-detail-badges">
            <span className={`gemma-platform ${detail.platform}`}>{PLATFORM_NAMES[detail.platform] || detail.platform}</span>
            <span>{TYPE_LABELS[detail.contentKind]}</span>
            <span className={`nli-admin-status ${detail.status}`}>{statusNames[detail.status]}</span>
            {detail.layer3Level && <span className="nli-table-level">{detail.layer3Level}</span>}
          </div>

          <DetailSection title="Conteúdo avaliado" icon={<FileText size={16} />}>
            <p className="gemma-full-text">{detail.text}</p>
          </DetailSection>

          <div className="gemma-detail-grid">
            <DetailField label="Avaliador" value={detail.reviewer.name} />
            <DetailField label="Usuário" value={`@${detail.reviewer.username}`} />
            <DetailField label="Atribuído em" value={new Date(detail.assignedAt).toLocaleString("pt-BR")} />
            <DetailField label="Concluído em" value={detail.reviewedAt ? new Date(detail.reviewedAt).toLocaleString("pt-BR") : "—"} />
          </div>

          <DetailSection title="Gold de discurso de ódio" icon={<ShieldCheck size={16} />}>
            <div className="nli-detail-tags">
              {detail.gold.hateTypeNames.length
                ? detail.gold.hateTypeNames.map((type) => <span key={type}>{type}</span>)
                : <span>Sem tipos específicos</span>}
            </div>
          </DetailSection>

          <DetailSection title="Camada 3 · Respostas humanas" icon={<Layers3 size={16} />}>
            <div className="nli-admin-answers">
              {["N5", "N4", "N3", "N2", "N1"].map((entry) => {
                const answer = detail.layer3Answers[entry as NliLayer3Level];
                return (
                  <span key={entry}>
                    <strong>{entry}</strong>
                    <em className={answer === true ? "yes" : answer === false ? "no" : "unasked"}>
                      {answer === true ? "Sim" : answer === false ? "Não" : "Não perguntada"}
                    </em>
                  </span>
                );
              })}
            </div>
          </DetailSection>

          <DetailSection title="Camada 4 · Dimensões humanas" icon={<GitCompareArrows size={16} />}>
            <div className="nli-detail-tags">
              {detail.layer4Dimensions.length
                ? detail.layer4Dimensions.map((entry) => <span key={entry}>{dimensionNames[entry] || entry}</span>)
                : <span>Nenhuma dimensão marcada</span>}
            </div>
          </DetailSection>

          {detail.note && (
            <DetailSection title="Observação do avaliador" icon={<Edit3 size={16} />}>
              <p>{detail.note}</p>
            </DetailSection>
          )}

          <DetailSection title="Saídas NLI do modelo" icon={<BrainCircuit size={16} />}>
            <div className="nli-model-comparison">
              <div>
                <strong>Camada 3 do modelo</strong>
                {detail.model.layer3 ? (
                  <>
                    <span>{detail.model.layer3.primaryDimension || "Sem dimensão principal"}</span>
                    <small>{detail.model.layer3.modelName} · {detail.model.layer3.primaryScore === null ? "sem score" : percent(detail.model.layer3.primaryScore)}</small>
                  </>
                ) : <span>Sem inferência vinculada</span>}
              </div>
              <div>
                <strong>Camada 4 do modelo</strong>
                {detail.model.layer4 ? (
                  <>
                    <span>{detail.model.layer4.activeDimensions.map((entry) => dimensionNames[entry] || entry).join(", ") || "Nenhuma dimensão ativa"}</span>
                    <small>{detail.model.layer4.modelName} · {detail.model.layer4.primaryScore === null ? "sem score" : percent(detail.model.layer4.primaryScore)}</small>
                  </>
                ) : <span>Sem inferência vinculada</span>}
              </div>
            </div>
          </DetailSection>
        </div>
      </aside>
    </div>
  );
}

function GemmaDataView() {
  const [data, setData] = useState<GemmaDataResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [label, setLabel] = useState("");
  const [contentKind, setContentKind] = useState("");
  const [hateType, setHateType] = useState("");
  const [modelKey, setModelKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [detail, setDetail] = useState<GemmaAnalysisDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (search) params.set("search", search);
        if (platform) params.set("platform", platform);
        if (status) params.set("status", status);
        if (label) params.set("label", label);
        if (contentKind) params.set("contentKind", contentKind);
        if (hateType) params.set("hateType", hateType);
        if (modelKey) {
          const [model, promptVersion] = modelKey.split("\u001f");
          params.set("model", model);
          params.set("promptVersion", promptVersion);
        }
        const response = await fetch(`/api/admin/gemma-data?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "Não foi possível carregar os dados.");
        }
        setData(body);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Falha ao carregar dados.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    contentKind,
    hateType,
    label,
    modelKey,
    page,
    pageSize,
    platform,
    refreshToken,
    search,
    status,
  ]);

  function changeFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setSearch(draftSearch.trim());
  }

  function clearFilters() {
    setDraftSearch("");
    setSearch("");
    setPlatform("");
    setStatus("");
    setLabel("");
    setContentKind("");
    setHateType("");
    setModelKey("");
    setPage(1);
  }

  async function openDetail(analysisId: number) {
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/gemma-data/${analysisId}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível abrir a análise.");
      }
      setDetail(body.analysis);
    } catch (cause) {
      setDetailError(
        cause instanceof Error ? cause.message : "Falha ao abrir análise.",
      );
    } finally {
      setDetailLoading(false);
    }
  }

  const hasFilters = Boolean(
    search ||
      platform ||
      status ||
      label ||
      contentKind ||
      hateType ||
      modelKey,
  );

  return (
    <section className="gemma-data-view">
      <header className="gemma-data-heading">
        <div>
          <Database size={20} />
          <span>
            <strong>Banco de análises do Gemma</strong>
            <small>
              Consulte todas as inferências sem carregar o banco inteiro de uma vez.
            </small>
          </span>
        </div>
        <div className="gemma-data-total">
          <strong>{number(data?.total || 0)}</strong>
          <span>registros encontrados</span>
        </div>
      </header>

      <form className="gemma-search" onSubmit={submitSearch}>
        <label>
          <Search size={16} />
          <input
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Buscar por texto, ID da análise ou ID externo"
          />
        </label>
        <button type="submit">Buscar</button>
        <button
          className="gemma-refresh"
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          title="Atualizar dados"
        >
          <RotateCcw size={16} />
        </button>
      </form>

      <div className="gemma-filters">
        <select
          value={platform}
          onChange={(event) => changeFilter(setPlatform, event.target.value)}
          aria-label="Filtrar por rede social"
        >
          <option value="">Todas as redes</option>
          {PLATFORMS.slice(1).map(([value, name]) => (
            <option value={value} key={value}>{name}</option>
          ))}
        </select>
        <select
          value={contentKind}
          onChange={(event) => changeFilter(setContentKind, event.target.value)}
          aria-label="Filtrar por tipo de conteúdo"
        >
          <option value="">Posts e comentários</option>
          <option value="post">Posts</option>
          <option value="comment">Comentários</option>
        </select>
        <select
          value={status}
          onChange={(event) => changeFilter(setStatus, event.target.value)}
          aria-label="Filtrar por status"
        >
          <option value="">Todos os status</option>
          <option value="success">Sucesso</option>
          <option value="error">Erro</option>
        </select>
        <select
          value={label}
          onChange={(event) => changeFilter(setLabel, event.target.value)}
          aria-label="Filtrar por rótulo"
        >
          <option value="">Hate e não hate</option>
          <option value="hate">Hate</option>
          <option value="nao_hate">Não hate</option>
        </select>
        <select
          value={hateType}
          onChange={(event) => changeFilter(setHateType, event.target.value)}
          aria-label="Filtrar por tipo de hate"
        >
          <option value="">Todos os tipos de hate</option>
          {(data?.filters.hateTypes || []).map((type) => (
            <option value={type.code} key={type.code}>{type.name}</option>
          ))}
        </select>
        <select
          value={modelKey}
          onChange={(event) => changeFilter(setModelKey, event.target.value)}
          aria-label="Filtrar por modelo e prompt"
        >
          <option value="">Todos os modelos</option>
          {(data?.filters.models || []).map((model) => (
            <option
              value={`${model.model}\u001f${model.promptVersion}`}
              key={`${model.model}-${model.promptVersion}`}
            >
              {model.model} · {model.promptVersion} ({number(model.total)})
            </option>
          ))}
        </select>
        {hasFilters && (
          <button type="button" onClick={clearFilters}>Limpar filtros</button>
        )}
      </div>

      {error && (
        <div className="metrics-inline-error">
          <AlertCircle size={16} />{error}
        </div>
      )}

      <div className={`gemma-table-shell ${loading ? "loading" : ""}`}>
        <table className="gemma-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Rede</th>
              <th>Conteúdo</th>
              <th>Classificação</th>
              <th>Tipos</th>
              <th>Status</th>
              <th>Modelo</th>
              <th>Data</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && data?.rows.length === 0 ? (
              <tr>
                <td className="gemma-empty-row" colSpan={9}>
                  Nenhum registro encontrado para estes filtros.
                </td>
              </tr>
            ) : (
              (data?.rows || []).map((row) => (
                <tr key={row.analysisId}>
                  <td><strong>#{row.analysisId}</strong><small>{TYPE_LABELS[row.contentKind]}</small></td>
                  <td>
                    <span className={`gemma-platform ${row.platform}`}>
                      {PLATFORM_NAMES[row.platform] || row.platform}
                    </span>
                  </td>
                  <td className="gemma-text-cell">
                    <strong>{row.text}</strong>
                    <small>
                      {row.externalId}
                      {row.duplicateCount > 0
                        ? ` · ${number(row.duplicateCount)} duplicata(s)`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {row.label ? (
                      <span className={`gemma-label ${row.label}`}>
                        {row.label === "hate" ? "HATE" : "NÃO HATE"}
                      </span>
                    ) : "—"}
                    <small>
                      {row.hateProbability === null
                        ? "Sem probabilidade"
                        : percent(row.hateProbability)}
                    </small>
                  </td>
                  <td>
                    <div className="gemma-type-list">
                      {row.hateTypes.length
                        ? row.hateTypes.slice(0, 2).map((type) => (
                            <span key={type}>{type}</span>
                          ))
                        : "—"}
                      {row.hateTypes.length > 2 && (
                        <em>+{row.hateTypes.length - 2}</em>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`gemma-status ${row.status}`}>
                      {row.status === "success" ? "Sucesso" : "Erro"}
                    </span>
                    {row.review && <small>Humano: {row.review.status}</small>}
                  </td>
                  <td className="gemma-model-cell">
                    <strong>{row.modelName}</strong>
                    <small>{row.promptVersion}</small>
                  </td>
                  <td>
                    {row.analyzedAt
                      ? new Date(row.analyzedAt).toLocaleDateString("pt-BR")
                      : "—"}
                    <small>{seconds(row.inferenceSeconds)}</small>
                  </td>
                  <td>
                    <button
                      className="gemma-view-button"
                      onClick={() => openDetail(row.analysisId)}
                      title="Ver análise completa"
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {loading && (
          <div className="gemma-table-loading">
            <RotateCcw size={22} />Carregando registros...
          </div>
        )}
      </div>

      <footer className="gemma-pagination">
        <label>
          Por página
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <span>
          Página <strong>{data?.page || page}</strong> de{" "}
          <strong>{number(data?.totalPages || 1)}</strong>
        </span>
        <div>
          <button
            disabled={loading || page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            aria-label="Página anterior"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            disabled={loading || page >= (data?.totalPages || 1)}
            onClick={() => setPage((value) => value + 1)}
            aria-label="Próxima página"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </footer>

      {(detailLoading || detail || detailError) && (
        <GemmaDetailPanel
          detail={detail}
          loading={detailLoading}
          error={detailError}
          close={() => {
            setDetail(null);
            setDetailError("");
            setDetailLoading(false);
          }}
        />
      )}
    </section>
  );
}

function GemmaDetailPanel({
  detail,
  loading,
  error,
  close,
}: {
  detail: GemmaAnalysisDetail | null;
  loading: boolean;
  error: string;
  close: () => void;
}) {
  return (
    <div className="gemma-detail-overlay" role="dialog" aria-modal="true">
      <aside className="gemma-detail-panel">
        <header>
          <div>
            <span className="eyebrow">ANÁLISE COMPLETA</span>
            <h3>{detail ? `Registro #${detail.analysisId}` : "Carregando registro"}</h3>
          </div>
          <button onClick={close} aria-label="Fechar detalhes"><X size={19} /></button>
        </header>
        {loading ? (
          <div className="gemma-detail-loading">
            <RotateCcw size={24} />Carregando todos os campos...
          </div>
        ) : error ? (
          <div className="metrics-error">
            <AlertCircle size={20} /><div><strong>Não foi possível abrir</strong><span>{error}</span></div>
          </div>
        ) : detail ? (
          <div className="gemma-detail-content">
            <div className="gemma-detail-badges">
              <span className={`gemma-platform ${detail.platform}`}>
                {PLATFORM_NAMES[detail.platform] || detail.platform}
              </span>
              <span>{TYPE_LABELS[detail.contentKind]}</span>
              <span className={`gemma-status ${detail.status}`}>
                {detail.status === "success" ? "Sucesso" : "Erro"}
              </span>
              {detail.label && (
                <span className={`gemma-label ${detail.label}`}>
                  {detail.label === "hate" ? "HATE" : "NÃO HATE"}
                </span>
              )}
            </div>

            <DetailSection title="Conteúdo original" icon={<FileText size={16} />}>
              <p className="gemma-full-text">{detail.text}</p>
            </DetailSection>

            <div className="gemma-detail-grid">
              <DetailField label="Modelo" value={detail.modelName} />
              <DetailField label="Prompt" value={detail.promptVersion} />
              <DetailField
                label="Probabilidade de hate"
                value={
                  detail.hateProbability === null
                    ? "—"
                    : percent(detail.hateProbability)
                }
              />
              <DetailField
                label="Tempo de inferência"
                value={seconds(detail.inferenceSeconds)}
              />
              <DetailField label="Tentativas" value={String(detail.attemptCount)} />
              <DetailField
                label="Analisado em"
                value={
                  detail.analyzedAt
                    ? new Date(detail.analyzedAt).toLocaleString("pt-BR")
                    : "—"
                }
              />
              <DetailField label="Execução" value={detail.runName || `#${detail.runId}`} />
              <DetailField label="ID de origem" value={detail.externalId} />
            </div>

            {detail.hateTypes.length > 0 && (
              <DetailSection title="Tipos de hate" icon={<Target size={16} />}>
                <div className="gemma-detail-types">
                  {detail.hateTypes.map((type) => <span key={type}>{type}</span>)}
                </div>
              </DetailSection>
            )}
            {detail.target && (
              <DetailSection title="Alvo identificado">
                <p>{detail.target}</p>
              </DetailSection>
            )}
            {detail.evidence && (
              <DetailSection title="Evidência textual">
                <blockquote>{detail.evidence}</blockquote>
              </DetailSection>
            )}
            {detail.justification && (
              <DetailSection title="Justificativa do Gemma">
                <p>{detail.justification}</p>
              </DetailSection>
            )}
            {detail.errorMessage && (
              <DetailSection title="Erro da inferência">
                <p className="gemma-error-message">{detail.errorMessage}</p>
              </DetailSection>
            )}
            {detail.review && (
              <DetailSection title="Avaliação humana" icon={<Users size={16} />}>
                <div className="gemma-review-detail">
                  <strong>{detail.review.reviewerName || "Avaliador"}</strong>
                  <span>Status: {detail.review.status}</span>
                  <span>Rótulo gold: {detail.review.finalLabel || "—"}</span>
                  {detail.review.note && <p>{detail.review.note}</p>}
                </div>
              </DetailSection>
            )}
            {detail.rawResponse && (
              <details className="gemma-raw-response">
                <summary>Resposta bruta do modelo</summary>
                <pre>{detail.rawResponse}</pre>
              </details>
            )}
            <details className="gemma-raw-response">
              <summary>Identificadores técnicos</summary>
              <pre>{`analysis_id: ${detail.analysisId}\ncanonical_analysis_id: ${detail.canonicalAnalysisId}\nduplicatas_exatas: ${detail.duplicateCount}\nrun_id: ${detail.runId}\nsource_id: ${detail.sourceId}\ntext_hash: ${detail.textHash}\nexternal_id: ${detail.externalId}\nreused_from: ${detail.reusedFromAnalysisId || "não"}`}</pre>
            </details>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="gemma-detail-section">
      <h4>{icon}{title}</h4>
      {children}
    </section>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="gemma-detail-field"><span>{label}</span><strong>{value}</strong></div>;
}

function AdminMetricsView({
  metrics,
  loading,
  error,
  reload,
}: {
  metrics: AdminMetrics | null;
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  if (loading && !metrics) {
    return (
      <div className="metrics-loading">
        <div className="pulse-line wide" />
        <div className="metrics-loading-grid">
          <div /><div /><div /><div />
        </div>
        <div className="metrics-loading-panel" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="metrics-error">
        <AlertCircle size={22} />
        <div><strong>Métricas indisponíveis</strong><span>{error}</span></div>
        <button onClick={reload}>Tentar novamente</button>
      </div>
    );
  }

  const sampleIsSmall = metrics.model.sampleSize < 30;
  const usedTypes = metrics.hateTypes.filter(
    (type) => type.predicted > 0 || type.gold > 0,
  );
  const maxDaily = Math.max(1, ...metrics.daily.map((day) => day.reviewed));

  return (
    <div className="metrics-dashboard">
      <div className="metrics-context">
        <div>
          <BrainCircuit size={20} />
          <span><strong>{metrics.inference.model}</strong>{metrics.inference.promptVersion}</span>
        </div>
        <button onClick={reload} disabled={loading}>
          <RotateCcw size={15} />{loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      {error && (
        <div className="metrics-inline-error"><AlertCircle size={16} />{error}</div>
      )}
      {sampleIsSmall && (
        <div className="sample-warning">
          <AlertCircle size={18} />
          <div>
            <strong>Amostra humana ainda inicial</strong>
            <span>
              As métricas do LLM usam {number(metrics.model.sampleSize)} avaliações.
              Interprete os percentuais como preliminares até ampliar o dataset gold.
            </span>
          </div>
        </div>
      )}

      <section className="metrics-section">
        <div className="metrics-section-heading">
          <div><Database size={19} /><span><strong>Avaliação do dataset</strong><small>Progresso da validação humana</small></span></div>
          <time>Atualizado {new Date(metrics.generatedAt).toLocaleString("pt-BR")}</time>
        </div>

        <div className="metric-cards">
          <MetricCard
            icon={<Database size={18} />}
            label="Inferências disponíveis"
            value={number(metrics.dataset.totalAnalyses)}
            note={`${number(metrics.dataset.uniqueTexts)} textos únicos`}
          />
          <MetricCard
            icon={<Check size={18} />}
            label="Avaliações concluídas"
            value={number(metrics.dataset.reviewed)}
            note={`${number(metrics.dataset.confirmed)} confirmadas · ${number(metrics.dataset.corrected)} corrigidas`}
          />
          <MetricCard
            icon={<Gauge size={18} />}
            label="Progresso do gold"
            value={metricPercent(metrics.dataset.progress)}
            note={`${number(metrics.dataset.assigned)} em avaliação`}
            tone="teal"
          />
          <MetricCard
            icon={<Activity size={18} />}
            label="Ritmo recente"
            value={number(metrics.dataset.reviewedLast7Days)}
            note={`${number(metrics.dataset.reviewedToday)} avaliadas hoje`}
          />
        </div>

        <div className="dataset-detail-grid">
          <div className="dataset-progress-card">
            <div><strong>Cobertura do dataset gold</strong><span>{metricPercent(metrics.dataset.progress)}</span></div>
            <div className="dataset-progress-track">
              <span style={{ width: `${(metrics.dataset.progress || 0) * 100}%` }} />
            </div>
            <div className="dataset-facts">
              <span><strong>{number(metrics.dataset.reviewedUniqueTexts)}</strong> textos únicos revisados</span>
              <span><strong>{number(metrics.dataset.activeReviewers)}</strong> avaliadores ativos</span>
              <span><strong>{seconds(metrics.dataset.averageReviewSeconds)}</strong> tempo médio por item</span>
              <span><strong>{number(metrics.dataset.reusedAnalyses)}</strong> inferências reaproveitadas</span>
            </div>
          </div>
          <div className="daily-card">
            <div><strong>Atividade nos últimos 30 dias</strong><span>{number(metrics.dataset.reviewedLast7Days)} na última semana</span></div>
            {metrics.daily.length ? (
              <div className="daily-bars" aria-label="Avaliações por dia">
                {metrics.daily.map((day) => (
                  <span
                    key={day.date}
                    style={{ height: `${Math.max(8, (day.reviewed / maxDaily) * 100)}%` }}
                    title={`${new Date(`${day.date}T12:00:00`).toLocaleDateString("pt-BR")}: ${day.reviewed} avaliações`}
                  />
                ))}
              </div>
            ) : (
              <p className="metrics-empty">Nenhuma avaliação concluída no período.</p>
            )}
          </div>
        </div>
      </section>

      <section className="metrics-section">
        <div className="metrics-section-heading">
          <div>
            <Layers3 size={19} />
            <span>
              <strong>Avaliação das camadas NLI</strong>
              <small>Gravidade N1–N5 e dimensões discursivas do gold HATE</small>
            </span>
          </div>
          <em>{number(metrics.nli.eligible)} itens HATE elegíveis</em>
        </div>

        <div className="metric-cards">
          <MetricCard
            icon={<Check size={18} />}
            label="NLI concluídos"
            value={number(metrics.nli.completed)}
            note={`${number(metrics.nli.activeReviewers)} avaliadores ativos`}
          />
          <MetricCard
            icon={<Gauge size={18} />}
            label="Progresso NLI"
            value={metricPercent(metrics.nli.progress)}
            note={`${number(metrics.nli.assigned)} em avaliação`}
            tone="teal"
          />
          <MetricCard
            icon={<Clock3 size={18} />}
            label="Aguardando NLI"
            value={number(metrics.nli.waiting)}
            note={`${number(metrics.nli.skipped)} pulados`}
          />
          <MetricCard
            icon={<Activity size={18} />}
            label="Tempo médio NLI"
            value={seconds(metrics.nli.averageReviewSeconds)}
            note="Da reserva até o envio"
          />
        </div>

        <div className="nli-metrics-grid">
          <div>
            <strong>Distribuição da Camada 3</strong>
            <div className="nli-metric-bars">
              {metrics.nli.layer3.map((entry) => (
                <div key={entry.level}>
                  <span>{entry.level}</span>
                  <div><i style={{
                    width: `${metrics.nli.completed > 0
                      ? (entry.count / metrics.nli.completed) * 100
                      : 0}%`,
                  }} /></div>
                  <strong>{number(entry.count)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div>
            <strong>Marcações da Camada 4</strong>
            <div className="nli-metric-dimensions">
              {metrics.nli.layer4.map((entry) => (
                <span key={entry.code}>
                  <small>{entry.name}</small><strong>{number(entry.count)}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-section">
        <div className="metrics-section-heading">
          <div><BrainCircuit size={19} /><span><strong>Qualidade do modelo LLM</strong><small>Gemma comparado aos rótulos humanos</small></span></div>
          <em>{number(metrics.model.sampleSize)} itens no gold</em>
        </div>

        <div className="metric-cards model-cards">
          <MetricCard icon={<Target size={18} />} label="Concordância" value={metricPercent(metrics.model.agreement)} note="Acurácia global" tone="teal" />
          <MetricCard icon={<TrendingUp size={18} />} label="Precisão — hate" value={metricPercent(metrics.model.precision)} note="Dos hates previstos, quantos eram hate" />
          <MetricCard icon={<Activity size={18} />} label="Recall — hate" value={metricPercent(metrics.model.recall)} note="Dos hates reais, quantos foram encontrados" />
          <MetricCard icon={<Gauge size={18} />} label="F1-score — hate" value={metricPercent(metrics.model.f1)} note="Equilíbrio entre precisão e recall" />
        </div>

        <div className="model-detail-grid">
          <div className="confusion-card">
            <div className="card-title"><strong>Matriz de confusão</strong><span>Previsão do Gemma × avaliação humana</span></div>
            <div className="confusion-axis"><span>Gold: hate</span><span>Gold: não hate</span></div>
            <div className="confusion-grid">
              <div className="positive"><small>Verdadeiro positivo</small><strong>{number(metrics.model.truePositive)}</strong><span>Gemma: hate</span></div>
              <div className="negative"><small>Falso positivo</small><strong>{number(metrics.model.falsePositive)}</strong><span>Gemma: hate</span></div>
              <div className="negative"><small>Falso negativo</small><strong>{number(metrics.model.falseNegative)}</strong><span>Gemma: não hate</span></div>
              <div className="positive"><small>Verdadeiro negativo</small><strong>{number(metrics.model.trueNegative)}</strong><span>Gemma: não hate</span></div>
            </div>
          </div>
          <div className="model-summary-card">
            <div className="card-title"><strong>Leitura do modelo</strong><span>Indicadores complementares</span></div>
            <MetricRow label="Especificidade" value={metricPercent(metrics.model.specificity)} />
            <MetricRow label="Concordância dos tipos" value={metricPercent(metrics.model.typeAgreement)} />
            <MetricRow label="Hate previsto pelo Gemma" value={number(metrics.model.gemmaHate)} />
            <MetricRow label="Hate confirmado no gold" value={number(metrics.model.goldHate)} />
            <MetricRow label="Tempo médio de inferência" value={seconds(metrics.inference.averageSeconds)} />
            <MetricRow label="Erros da inferência" value={number(metrics.inference.errors)} />
          </div>
        </div>

        <div className="model-error-examples">
          <ModelErrorExamples
            title="Falsos positivos"
            description="O Gemma marcou hate, mas a avaliação humana marcou não hate."
            examples={metrics.model.examples.falsePositives}
            tone="false-positive"
          />
          <ModelErrorExamples
            title="Falsos negativos"
            description="O Gemma marcou não hate, mas especialistas identificaram hate."
            examples={metrics.model.examples.falseNegatives}
            tone="false-negative"
          />
        </div>
      </section>

      <section className="metrics-section">
        <div className="metrics-section-heading">
          <div><BarChart3 size={19} /><span><strong>Métricas por rede social</strong><small>Cobertura e concordância do modelo</small></span></div>
        </div>
        <div className="metrics-table-wrap">
          <table className="metrics-table">
            <thead><tr><th>Rede</th><th>Inferências</th><th>Revisadas</th><th>Progresso</th><th>Concordância</th><th>Corrigidas</th></tr></thead>
            <tbody>
              {metrics.platforms.map((platform) => (
                <tr key={platform.platform}>
                  <td><span className={`platform-dot ${platform.platform}`} />{PLATFORM_NAMES[platform.platform] || platform.platform}</td>
                  <td>{number(platform.total)}</td>
                  <td>{number(platform.reviewed)}</td>
                  <td><div className="table-progress"><span><i style={{ width: `${(platform.progress || 0) * 100}%` }} /></span><em>{metricPercent(platform.progress)}</em></div></td>
                  <td>{metricPercent(platform.agreement)}</td>
                  <td>{number(platform.corrected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="metrics-two-columns">
        <section className="metrics-section compact">
          <div className="metrics-section-heading">
            <div><Users size={19} /><span><strong>Produção por avaliador</strong><small>Distribuição do trabalho humano</small></span></div>
          </div>
          <div className="metrics-table-wrap">
            <table className="metrics-table compact-table">
              <thead><tr><th>Avaliador</th><th>Revisadas</th><th>Corrigidas</th></tr></thead>
              <tbody>
                {metrics.reviewers.map((reviewer) => (
                  <tr key={reviewer.reviewerId}>
                    <td><strong>{reviewer.displayName}</strong><small>@{reviewer.username}</small></td>
                    <td>{number(reviewer.reviewed)}</td>
                    <td>{number(reviewer.corrected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="metrics-section compact">
          <div className="metrics-section-heading">
            <div><Target size={19} /><span><strong>Desempenho por tipo de hate</strong><small>Métricas multirrótulo</small></span></div>
          </div>
          {usedTypes.length ? (
            <div className="metrics-table-wrap">
              <table className="metrics-table compact-table">
                <thead><tr><th>Tipo</th><th>Gold</th><th>Precisão</th><th>Recall</th></tr></thead>
                <tbody>
                  {usedTypes.map((type) => (
                    <tr key={type.code}>
                      <td><strong>{type.name}</strong></td>
                      <td>{number(type.gold)}</td>
                      <td>{metricPercent(type.precision)}</td>
                      <td>{metricPercent(type.recall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="metrics-empty spacious">Ainda não há casos de hate avaliados para calcular métricas por tipo.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ModelErrorExamples({
  title,
  description,
  examples,
  tone,
}: {
  title: string;
  description: string;
  examples: ModelErrorExample[];
  tone: "false-positive" | "false-negative";
}) {
  return (
    <section className={`model-example-card ${tone}`}>
      <header>
        <strong>{title}</strong>
        <span>{description}</span>
      </header>
      {examples.length ? (
        <div>
          {examples.map((example) => (
            <article key={example.analysisId}>
              <span className={`platform-dot ${example.platform}`} />
              <p>{example.text}</p>
              <small>
                #{example.analysisId} ·{" "}
                {PLATFORM_NAMES[example.platform] || example.platform}
                {example.goldHateTypes.length
                  ? ` · Gold: ${example.goldHateTypes.join(", ")}`
                  : ""}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <p className="metrics-empty">Nenhum exemplo disponível até agora.</p>
      )}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: "teal";
}) {
  return (
    <article className={`metric-card ${tone || ""}`}>
      <div>{icon}<span>{label}</span></div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return <div className="metric-row"><span>{label}</span><strong>{value}</strong></div>;
}

function SideStat({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="side-stat">
      {icon}
      <div><strong>{number(value)}</strong><span>{label}</span></div>
    </div>
  );
}

function ModelSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="model-section">
      <span>{title}</span>
      {children}
    </div>
  );
}

function FilterBar({
  filters,
  setFilters,
  reload,
}: {
  filters: ReviewFilters;
  setFilters: (filters: ReviewFilters) => void;
  reload: () => void;
}) {
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  return (
    <div className="filters">
      <SelectWrap label="Rede social">
        <select
          value={filters.platform}
          onChange={(event) =>
            setFilters({ ...filters, platform: event.target.value })
          }
        >
          {PLATFORMS.map(([value, label]) => (
            <option key={label} value={value}>{label}</option>
          ))}
        </select>
      </SelectWrap>
      <SelectWrap label="Tipo de conteúdo">
        <select
          value={filters.contentKind}
          onChange={(event) =>
            setFilters({ ...filters, contentKind: event.target.value })
          }
        >
          <option value="">Posts e comentários</option>
          <option value="post">Posts</option>
          <option value="comment">Comentários</option>
        </select>
      </SelectWrap>
      <SelectWrap label="Rótulo do Gemma">
        <select
          value={filters.gemmaLabel}
          onChange={(event) =>
            setFilters({ ...filters, gemmaLabel: event.target.value })
          }
        >
          <option value="">Todos os rótulos</option>
          <option value="hate">Gemma: hate</option>
          <option value="nao_hate">Gemma: não hate</option>
        </select>
      </SelectWrap>
      {activeFilterCount > 0 && (
        <button
          className="clear-review-filters"
          onClick={() =>
            setFilters({ platform: "", contentKind: "", gemmaLabel: "" })
          }
          title="Limpar filtros"
        >
          <X size={14} />
          {activeFilterCount}
        </button>
      )}
      <button
        className="icon-button"
        onClick={() => reload()}
        title="Atualizar fila"
        aria-label="Atualizar fila"
      >
        <RotateCcw size={17} />
      </button>
    </div>
  );
}

function SelectWrap({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      {children}
      <ChevronDown size={15} />
    </label>
  );
}

function resolveNliLevel(
  answers: Partial<Record<NliLayer3Level, boolean>>,
): NliLayer3Level | null {
  const positive = NLI_LAYER3_QUESTIONS.find(
    (question) => answers[question.level] === true,
  );
  if (positive) return positive.level;
  return NLI_LAYER3_QUESTIONS.every(
    (question) => answers[question.level] === false,
  )
    ? "N1"
    : null;
}

function InlineNliLayers({
  answers,
  setAnswers,
  selectedDimensions,
  setSelectedDimensions,
}: {
  answers: Partial<Record<NliLayer3Level, boolean>>;
  setAnswers: React.Dispatch<
    React.SetStateAction<Partial<Record<NliLayer3Level, boolean>>>
  >;
  selectedDimensions: string[];
  setSelectedDimensions: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const selectedLevel = resolveNliLevel(answers);
  const currentQuestionIndex = selectedLevel
    ? -1
    : NLI_LAYER3_QUESTIONS.findIndex(
        (question) => answers[question.level] === undefined,
      );

  return (
    <div className="inline-nli-flow">
      <section className="nli-layer-card">
        <header>
          <div className="nli-layer-number">3</div>
          <div>
            <span className="section-label">CAMADA 3</span>
            <h2>Qual é o nível de gravidade?</h2>
            <p>Responda em ordem. A sequência para no primeiro “sim”.</p>
          </div>
          {selectedLevel && (
            <div className={`nli-level-result ${selectedLevel.toLowerCase()}`}>
              <span>Nível definido</span><strong>{selectedLevel}</strong>
            </div>
          )}
        </header>

        <div className="nli-question-flow">
          {NLI_LAYER3_QUESTIONS.map((question, index) => {
            const answer = answers[question.level];
            const visible = answer !== undefined || index === currentQuestionIndex;
            if (!visible) return null;
            const active = index === currentQuestionIndex;
            return (
              <div
                className={`nli-question ${active ? "active" : "answered"}`}
                key={question.level}
              >
                <span className="nli-question-level">{question.level}</span>
                <div>
                  <strong>{question.question}</strong>
                  <small>{question.explanation}</small>
                </div>
                {active ? (
                  <div className="nli-binary-actions">
                    <button
                      type="button"
                      onClick={() => setAnswers((current) => ({
                        ...current,
                        [question.level]: false,
                      }))}
                    >Não</button>
                    <button
                      type="button"
                      className="yes"
                      onClick={() => setAnswers((current) => ({
                        ...current,
                        [question.level]: true,
                      }))}
                    >Sim</button>
                  </div>
                ) : (
                  <span className={`nli-answer ${answer ? "yes" : "no"}`}>
                    {answer ? "Sim" : "Não"}
                  </span>
                )}
              </div>
            );
          })}
          {selectedLevel === "N1" && (
            <div className="nli-question n1-result">
              <span className="nli-question-level">N1</span>
              <div>
                <strong>Preconceito implícito ou velado</strong>
                <small>
                  Estereótipo, piada ou referência negativa sem os sinais mais
                  graves descritos acima.
                </small>
              </div>
              <span className="nli-answer yes">Resultado</span>
            </div>
          )}
        </div>
        {Object.keys(answers).length > 0 && (
          <button
            type="button"
            className="nli-reset-layer"
            onClick={() => {
              setAnswers({});
              setSelectedDimensions([]);
            }}
          >
            <RotateCcw size={14} />Recomeçar Camada 3
          </button>
        )}
      </section>

      <section className={`nli-layer-card ${!selectedLevel ? "locked" : ""}`}>
        <header>
          <div className="nli-layer-number">4</div>
          <div>
            <span className="section-label">CAMADA 4</span>
            <h2>Quais dimensões estão presentes?</h2>
            <p>Marque nenhuma, uma ou várias dimensões.</p>
          </div>
          <span className="nli-selection-count">
            {number(selectedDimensions.length)} selecionada(s)
          </span>
        </header>
        {selectedLevel ? (
          <div className="nli-dimension-grid">
            {NLI_LAYER4_DIMENSIONS.map((dimension) => {
              const selected = selectedDimensions.includes(dimension.code);
              return (
                <button
                  type="button"
                  key={dimension.code}
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => setSelectedDimensions((current) =>
                    selected
                      ? current.filter((code) => code !== dimension.code)
                      : [...current, dimension.code],
                  )}
                >
                  <span className="nli-dimension-check">
                    {selected && <Check size={15} />}
                  </span>
                  <span>
                    <strong>{dimension.name}</strong>
                    <small>{dimension.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="nli-layer-locked-message">
            <Layers3 size={20} />Conclua a Camada 3 para liberar esta etapa.
          </div>
        )}
      </section>
    </div>
  );
}

function CorrectionPanel({
  categories,
  finalLabel,
  setFinalLabel,
  selectedTypes,
  setSelectedTypes,
  note,
  setNote,
  gemmaLabel,
  gemmaHateTypes,
  close,
  save,
  submitting,
  nliAnswers = {},
  setNliAnswers,
  nliDimensions = [],
  setNliDimensions,
  includeNli = false,
  title = "Qual é a classificação correta?",
  saveLabel = "Salvar correção e avançar",
}: {
  categories: Category[];
  finalLabel: "hate" | "nao_hate";
  setFinalLabel: (label: "hate" | "nao_hate") => void;
  selectedTypes: string[];
  setSelectedTypes: (types: string[]) => void;
  note: string;
  setNote: (note: string) => void;
  gemmaLabel: "hate" | "nao_hate";
  gemmaHateTypes: string[];
  close: () => void;
  save: () => void;
  submitting: boolean;
  nliAnswers?: Partial<Record<NliLayer3Level, boolean>>;
  setNliAnswers?: React.Dispatch<
    React.SetStateAction<Partial<Record<NliLayer3Level, boolean>>>
  >;
  nliDimensions?: string[];
  setNliDimensions?: React.Dispatch<React.SetStateAction<string[]>>;
  includeNli?: boolean;
  title?: string;
  saveLabel?: string;
}) {
  const categoryNames = Object.fromEntries(
    categories.map((category) => [category.code, category.name]),
  );
  const selectedNames = selectedTypes.map(
    (type) => categoryNames[type] || type,
  );
  const gemmaTypeNames = gemmaHateTypes.map(
    (type) => categoryNames[type] || type,
  );
  const missingHateType =
    finalLabel === "hate" && selectedTypes.length === 0;
  const nliLevel = resolveNliLevel(nliAnswers);
  const missingNli = includeNli && finalLabel === "hate" && !nliLevel;

  return (
    <section className="correction-panel" aria-busy={submitting}>
      <div className="correction-heading">
        <div>
          <span className="section-label">CORREÇÃO DO ESPECIALISTA</span>
          <h3>{title}</h3>
        </div>
        <button onClick={close} aria-label="Fechar correção">×</button>
      </div>

      <div className="correction-comparison">
        <div>
          <span>Predição do Gemma</span>
          <strong className={gemmaLabel}>
            {gemmaLabel === "hate" ? "HATE" : "NÃO HATE"}
          </strong>
          <small>{gemmaTypeNames.join(", ") || "Sem tipos"}</small>
        </div>
        <ArrowRight size={18} />
        <div>
          <span>Sua decisão</span>
          <strong className={finalLabel}>
            {finalLabel === "hate" ? "HATE" : "NÃO HATE"}
          </strong>
          <small>{selectedNames.join(", ") || "Sem tipos"}</small>
        </div>
      </div>

      <div className="integrated-layer-heading">
        <span className="nli-layer-number">1</span>
        <div>
          <span className="section-label">CAMADA 1</span>
          <strong>Classificação binária</strong>
        </div>
      </div>

      <div className="label-choice">
        <button
          type="button"
          className={finalLabel === "hate" ? "selected hate" : ""}
          aria-pressed={finalLabel === "hate"}
          onClick={() => setFinalLabel("hate")}
        >
          Discurso de ódio
        </button>
        <button
          type="button"
          className={finalLabel === "nao_hate" ? "selected safe" : ""}
          aria-pressed={finalLabel === "nao_hate"}
          onClick={() => {
            setFinalLabel("nao_hate");
            setSelectedTypes([]);
            setNliAnswers?.({});
            setNliDimensions?.([]);
          }}
        >
          Não é discurso de ódio
        </button>
      </div>

      {finalLabel === "hate" && (
        <div className="category-picker">
          <div className="integrated-layer-heading compact">
            <span className="nli-layer-number">2</span>
            <div>
              <span className="section-label">CAMADA 2</span>
              <strong>Categorias de preconceito</strong>
            </div>
          </div>
          <span>Selecione um ou mais tipos</span>
          <div>
            {categories.map((category) => {
              const selected = selectedTypes.includes(category.code);
              return (
                <button
                  type="button"
                  key={category.code}
                  className={selected ? "selected" : ""}
                  title={category.description || undefined}
                  aria-pressed={selected}
                  onClick={() =>
                    setSelectedTypes(
                      selected
                        ? selectedTypes.filter((code) => code !== category.code)
                        : [...selectedTypes, category.code],
                    )
                  }
                >
                  {selected && <Check size={14} />}
                  {category.name}
                </button>
              );
            })}
          </div>
          {missingHateType && (
            <small className="category-required">
              Selecione pelo menos um tipo para salvar como HATE.
            </small>
          )}
        </div>
      )}

      {includeNli &&
        finalLabel === "hate" &&
        setNliAnswers &&
        setNliDimensions && (
          <InlineNliLayers
            answers={nliAnswers}
            setAnswers={setNliAnswers}
            selectedDimensions={nliDimensions}
            setSelectedDimensions={setNliDimensions}
          />
        )}

      <label className="note-field">
        Observação <span>(opcional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Registre apenas o que for importante para auditoria."
          maxLength={2000}
        />
      </label>

      <button
        type="button"
        className="save-correction"
        onClick={save}
        disabled={submitting || missingHateType || missingNli}
      >
        {submitting ? (
          <>
            <RotateCcw className="spin" size={17} />
            Salvando correção...
          </>
        ) : (
          <>
            <Check size={18} />
            {saveLabel}
          </>
        )}
      </button>
    </section>
  );
}
