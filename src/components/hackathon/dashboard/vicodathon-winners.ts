export type WinnerMember = {
  fullName: string;
  role: "Solo" | "Team Leader" | "Member";
  college?: string;
  graduationYear?: number;
};

export type WinnerPlace = {
  place: 1 | 2 | 3 | 4 | 5;
  placeLabel: string;
  entryLabel: string;
  /** Brief title from their HackathonSubmission.problem */
  problemStatement: string;
  members: WinnerMember[];
};

export const VICODATHON_WINNERS: WinnerPlace[] = [
  {
    place: 1,
    placeLabel: "1st Place",
    entryLabel: "Prem Jha",
    problemStatement: "The Interview Agent",
    members: [
      
    ],
  },
  {
    place: 2,
    placeLabel: "2nd Place",
    entryLabel: "Subhojyoti Maity",
    problemStatement: "The Interview Agent",
    members: [
      
    ],
  },
  {
    place: 3,
    placeLabel: "3rd Place",
    entryLabel: "The Terrible Trio",
    problemStatement: "Autonomous AI Creator",
    members: [
      {
        fullName: "Devansh Dwivedi",
        role: "Team Leader",
        
      },
      {
        fullName: "Shruti Saxena",
        role: "Member",
        
      },
      {
        fullName: "Dhruv Naithani",
        role: "Member",
        
      },
    ],
  },
  {
    place: 4,
    placeLabel: "4th Place",
    entryLabel: "Arcade",
    problemStatement: "Redesign ABTalks",
    members: [
      {
        fullName: "Mohit Kabi",
        role: "Team Leader",
        
      },
      {
        fullName: "Chhayakanta Maharana",
        role: "Member",
        
      },
      {
        fullName: "Hari Pangi",
        role: "Member",
        
      },
    ],
  },
  {
    place: 5,
    placeLabel: "5th Place",
    entryLabel: "Shan Usmani",
    problemStatement: "Autonomous AI Creator",
    members: [
         
    ],
  },
];
