/** Shape of DailyTask.dayContent — shared by every track's day view. */

export interface LearningBullet {
  label: string;
  text: string;
}

export interface DayContent {
  title: string;
  tagline: string;
  module: string;
  difficulty: string;
  estimatedMinutes: number;
  deliverableFormat: string;
  learning: {
    summary: string;
    bullets: LearningBullet[];
  };
  tool?: {
    name: string;
    type: string;
    description: string;
    setupTitle: string;
    setupSteps: string[];
    linkUrl: string;
    linkLabel: string;
  };
  task: {
    title: string;
    steps: string[];
    solutionVideoUrl?: string;
  };
  solutionVideoUrl?: string;
  resources?: string[];
  promptTemplate: string;
  engagement: {
    type: string;
    description: string;
    hashtag: string;
  };
  deliverable: {
    description: string;
    format: string;
  };
}
