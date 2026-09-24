export const mission = {
  totalArtifacts: 15,
  startingClaims: 10,
  objective: {
    id: "QR-11",
    category: "CAMPUS INTEL",
    title: "Find the next marker",
    description: "Scan its QR code to reveal the challenge."
  },
  caseFile: {
    id: "case-01",
    title: "The Programmer",
    acceptedAnswer: "DHH",
    clues: [
      "He created a web framework whose philosophy includes optimizing for programmer happiness.",
      "His framework became known for Convention over Configuration.",
      "He later created an opinionated Linux distribution.",
      "He is commonly referred to by three initials."
    ]
  }
} as const;
