export type JobType = "general" | "sales";
export type Q1Route = "condition" | "personality" | "support" | "other";

export interface QuizResult {
  questionNumber: number;
  selectedAnswer: string;
  correct: boolean;
  scene: string;
}

export interface StoryResponses {
  q1: string;
  q2: string;
  q3: string;
}

export interface Reflection {
  mostImpressiveScenario: number | null;
  whyImpressive: string;
  pastExperience: string;
  happiestMoment: string;
}

export interface AppState {
  currentScreen: number;
  q1Route: Q1Route | null;
  answers: {
    q1: string;
    q2: string;
    q3: string;
    q4: string;
  };
  freeTexts: {
    q1?: string;
    q2?: string;
    q3?: string;
    q4?: string;
  };
  generalScore: number;
  salesScore: number;
  detectedJobType: JobType | null;
  yarigaiWord: string;
  storyResponses: StoryResponses;
  quizResults: QuizResult[];
  reflection: Reflection;
}

export const initialAppState: AppState = {
  currentScreen: 0,
  q1Route: null,
  answers: { q1: "", q2: "", q3: "", q4: "" },
  freeTexts: {},
  generalScore: 0,
  salesScore: 0,
  detectedJobType: null,
  yarigaiWord: "",
  storyResponses: { q1: "", q2: "", q3: "" },
  quizResults: [],
  reflection: {
    mostImpressiveScenario: null,
    whyImpressive: "",
    pastExperience: "",
    happiestMoment: "",
  },
};
