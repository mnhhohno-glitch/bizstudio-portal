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
  candidateName: string;
  answers: {
    q1: string;
    q2: string;
  };
  freeTexts: {
    q1?: string;
    q2?: string;
  };
  storyResponses: StoryResponses;
  quizResults: QuizResult[];
  reflection: Reflection;
  reportText: string;
}

export const initialAppState: AppState = {
  currentScreen: 0,
  candidateName: "",
  answers: { q1: "", q2: "" },
  freeTexts: {},
  storyResponses: { q1: "", q2: "", q3: "" },
  quizResults: [],
  reflection: {
    mostImpressiveScenario: null,
    whyImpressive: "",
    pastExperience: "",
    happiestMoment: "",
  },
  reportText: "",
};
