export const NLI_LAYER4_DIMENSIONS = [
  {
    code: "authoritarianism",
    name: "Autoritarismo discursivo",
    description:
      "Impõe ordem, obediência, expulsão, silenciamento ou retirada de direitos do grupo.",
  },
  {
    code: "dehumanization",
    name: "Desumanização",
    description:
      "Representa o grupo como menos humano, objeto, animal, doença, praga ou ameaça contaminante.",
  },
  {
    code: "factualization",
    name: "Produção de factualidade",
    description:
      "Apresenta generalizações hostis, boatos ou alegações sem base como se fossem fatos evidentes.",
  },
  {
    code: "social_dominance",
    name: "Dominância Social",
    description:
      "Afirma ou naturaliza hierarquias, superioridade e dominação de um grupo sobre outros.",
  },
  {
    code: "revictimization",
    name: "Revitimização e autovitimização",
    description:
      "Culpa novamente a vítima ou apresenta o grupo agressor/dominante como a verdadeira vítima.",
  },
] as const;

export const NLI_LAYER3_QUESTIONS = [
  {
    level: "N5",
    question:
      "Convoca, celebra ou justifica a eliminação ou morte do grupo?",
    explanation: "Incitação, celebração ou justificativa de extermínio e morte.",
  },
  {
    level: "N4",
    question:
      "Ameaça, deseja ou endossa violência física contra o grupo?",
    explanation: "Ameaça ou apoio explícito a agressão e violência física.",
  },
  {
    level: "N3",
    question:
      "Nega a humanidade ou a dignidade do grupo, animalizando ou coisificando?",
    explanation: "Desumanização, animalização ou redução do grupo a objetos.",
  },
  {
    level: "N2",
    question:
      "Ataca o grupo de forma aberta, com insulto, humilhação ou criminalização coletiva?",
    explanation: "Ataque aberto e generalizante contra o grupo.",
  },
] as const;

export type NliLayer3Level = "N1" | "N2" | "N3" | "N4" | "N5";

export function validateLayer3Answers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Responda à sequência da Camada 3." } as const;
  }
  const submitted = value as Record<string, unknown>;
  const normalized: Record<string, boolean> = {};
  let level: NliLayer3Level | null = null;

  for (const question of NLI_LAYER3_QUESTIONS) {
    const answer = submitted[question.level];
    if (level) {
      if (answer !== undefined && answer !== null) {
        return {
          error: "Há respostas registradas depois do primeiro sim.",
        } as const;
      }
      continue;
    }
    if (typeof answer !== "boolean") {
      return {
        error: `Responda sim ou não à pergunta ${question.level}.`,
      } as const;
    }
    normalized[question.level] = answer;
    if (answer) level = question.level;
  }

  if (!level) {
    level = "N1";
    normalized.N1 = true;
  }
  return { level, answers: normalized } as const;
}
