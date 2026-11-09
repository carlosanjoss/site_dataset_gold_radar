export const REVIEW_PLATFORM_TIERS = [
  ["twitter", "reddit", "facebook", "tiktok"],
  ["youtube"],
  ["whatsapp", "telegram"],
] as const;

const priorityByPlatform = new Map<string, number>(
  REVIEW_PLATFORM_TIERS.flatMap((platforms, priority) =>
    platforms.map((platform) => [platform, priority] as const),
  ),
);

export function reviewPlatformPriority(platform: string) {
  return priorityByPlatform.get(platform) ?? REVIEW_PLATFORM_TIERS.length;
}

export function reviewPlatformPrioritySql(
  column: "a.platform" | "platform",
) {
  const branches = REVIEW_PLATFORM_TIERS.map(
    (platforms, priority) =>
      `WHEN ${column} IN (${platforms.map((platform) => `'${platform}'`).join(", ")}) THEN ${priority}`,
  );
  return `CASE ${branches.join(" ")} ELSE ${REVIEW_PLATFORM_TIERS.length} END`;
}

export function reviewPlatformOrderValuesSql() {
  return REVIEW_PLATFORM_TIERS.flatMap((platforms, priority) =>
    platforms.map((platform) => `('${platform}', ${priority})`),
  ).join(",\n                ");
}
