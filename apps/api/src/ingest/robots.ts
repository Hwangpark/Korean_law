import { URL } from "node:url";

import { fetchHtml } from "./transport.js";
import type { FetchHtmlOptions, RobotsDecision } from "./types.js";

type RobotsGroup = {
  userAgents: string[];
  allow: string[];
  disallow: string[];
};

const DEFAULT_USER_AGENT = "KoreanLawLinkBot/0.1";

function parseRobotsTxt(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      current = null;
      continue;
    }

    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }

    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === "user-agent") {
      current ??= { userAgents: [], allow: [], disallow: [] };
      current.userAgents.push(value.toLowerCase());
      if (!groups.includes(current)) {
        groups.push(current);
      }
      continue;
    }

    if (!current) {
      continue;
    }

    if (field === "allow") {
      current.allow.push(value);
    } else if (field === "disallow") {
      current.disallow.push(value);
    }
  }

  return groups;
}

function matchesUserAgent(group: RobotsGroup, userAgent: string) {
  const normalized = userAgent.toLowerCase();
  return group.userAgents.some((item) => item === "*" || normalized.includes(item));
}

function matchesPath(rulePath: string, pathname: string) {
  const normalizedRule = rulePath.trim();
  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule === "/") {
    return true;
  }

  if (normalizedRule.includes("*")) {
    const escaped = normalizedRule
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, ".*");
    return new RegExp(`^${escaped}`).test(pathname);
  }

  return pathname.startsWith(normalizedRule);
}

function selectRule(groups: RobotsGroup[], userAgent: string, pathname: string) {
  const relevantGroups = groups.filter((group) => matchesUserAgent(group, userAgent));
  const scope = relevantGroups.length > 0 ? relevantGroups : groups.filter((group) => group.userAgents.includes("*"));
  const allow = scope.flatMap((group) => group.allow);
  const disallow = scope.flatMap((group) => group.disallow);

  let bestAllow = "";
  let bestDisallow = "";

  for (const rule of allow) {
    if (matchesPath(rule, pathname) && rule.length >= bestAllow.length) {
      bestAllow = rule;
    }
  }

  for (const rule of disallow) {
    if (matchesPath(rule, pathname) && rule.length > bestDisallow.length) {
      bestDisallow = rule;
    }
  }

  if (!bestAllow && !bestDisallow) {
    return { allowed: true, allow, disallow };
  }

  if (bestAllow.length >= bestDisallow.length) {
    return { allowed: true, allow, disallow };
  }

  return { allowed: false, allow, disallow };
}

export async function evaluateRobotsPolicy(
  sourceUrl: URL,
  options: FetchHtmlOptions,
  userAgent = DEFAULT_USER_AGENT
): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", sourceUrl);

  try {
    const result = await fetchHtml(robotsUrl, options);
    const groups = parseRobotsTxt(result.body);
    const decision = selectRule(groups, userAgent, sourceUrl.pathname || "/");

    return {
      checked: true,
      allowed: decision.allowed,
      sourceUrl: robotsUrl.toString(),
      userAgent,
      detail: decision.allowed ? "robots.txt permits crawl." : "robots.txt disallows crawl.",
      rules: {
        allow: decision.allow,
        disallow: decision.disallow
      }
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "robots.txt unavailable.";
    const http404 = /HTTP 404/i.test(detail);

    return {
      checked: http404,
      allowed: http404,
      sourceUrl: robotsUrl.toString(),
      userAgent,
      detail: http404
        ? "robots.txt not present; crawl allowed."
        : `robots.txt unavailable: ${detail}`
    };
  }
}
