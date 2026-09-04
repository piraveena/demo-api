const fs = require('fs');
const path = require('path');

const PROJECT_OWNER = 'piraveena';
const PROJECT_NUMBER = 2;
const SNAPSHOT_PATH = path.join(
  process.env.GITHUB_WORKSPACE,
  '.github/project-state/project-2-snapshot.json'
);

module.exports = async ({ github, core }) => {
  const items = await fetchAllItems(github);
  const current = buildSnapshot(items);

  const hadPreviousSnapshot = fs.existsSync(SNAPSHOT_PATH);
  const previous = hadPreviousSnapshot
    ? JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
    : {};

  const botGithubClient = new github.constructor({ auth: process.env.BOT_TOKEN });

  if (hadPreviousSnapshot) {
    await commentOnChanges({ botGithub: botGithubClient, core, previous, current });
  } else {
    core.info('No previous snapshot found; recording baseline without posting comments.');
  }

  fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2) + '\n');
};

async function fetchAllItems(github) {
  const query = `
    query($login: String!, $number: Int!, $after: String) {
      user(login: $login) {
        projectV2(number: $number) {
          items(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                __typename
                ... on Issue { number url repository { nameWithOwner } }
                ... on PullRequest { number url repository { nameWithOwner } }
                ... on DraftIssue { title }
              }
              fieldValues(first: 50) {
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldTextValue { text updatedAt creator { login } field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldNumberValue { number updatedAt creator { login } field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldDateValue { date updatedAt creator { login } field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt creator { login } field { ... on ProjectV2FieldCommon { name } } }
                  ... on ProjectV2ItemFieldIterationValue { title updatedAt creator { login } field { ... on ProjectV2FieldCommon { name } } }
                }
              }
            }
          }
        }
      }
    }`;

  let after = null;
  const nodes = [];
  for (;;) {
    const result = await github.graphql(query, {
      login: PROJECT_OWNER,
      number: PROJECT_NUMBER,
      after,
    });
    const items = result.user.projectV2.items;
    nodes.push(...items.nodes);
    if (!items.pageInfo.hasNextPage) break;
    after = items.pageInfo.endCursor;
  }
  return nodes;
}

function buildSnapshot(items) {
  const snapshot = {};
  for (const item of items) {
    const content = item.content;
    if (!content || content.__typename === 'DraftIssue') continue;

    const fields = {};
    for (const fv of item.fieldValues.nodes) {
      if (!fv.field || !fv.field.name) continue;
      fields[fv.field.name] = {
        value: extractValue(fv),
        updatedAt: fv.updatedAt ?? null,
        actor: fv.creator?.login ?? 'unknown',
      };
    }

    snapshot[item.id] = {
      repo: content.repository.nameWithOwner,
      number: content.number,
      url: content.url,
      fields,
    };
  }
  return snapshot;
}

function extractValue(fieldValue) {
  switch (fieldValue.__typename) {
    case 'ProjectV2ItemFieldTextValue':
      return fieldValue.text;
    case 'ProjectV2ItemFieldNumberValue':
      return fieldValue.number;
    case 'ProjectV2ItemFieldDateValue':
      return fieldValue.date;
    case 'ProjectV2ItemFieldSingleSelectValue':
      return fieldValue.name;
    case 'ProjectV2ItemFieldIterationValue':
      return fieldValue.title;
    default:
      return null;
  }
}

async function commentOnChanges({ botGithub, core, previous, current }) {
  const changedFields = new Set();

  for (const [itemId, item] of Object.entries(current)) {
    const before = previous[itemId];
    if (!before) continue;

    const itemChanges = [];
    const fieldNames = new Set([
      ...Object.keys(before.fields),
      ...Object.keys(item.fields),
    ]);
    for (const name of fieldNames) {
      const oldValue = before.fields[name]?.value ?? '_(empty)_';
      const newValue = item.fields[name]?.value ?? '_(empty)_';
      if (oldValue !== newValue) {
        const actor = item.fields[name]?.actor ?? 'unknown';
        itemChanges.push({ field: name, oldValue, newValue, actor });
      }
    }

    if (itemChanges.length === 0) continue;

    const [owner, repo] = item.repo.split('/');
    const body = itemChanges
      .map((c) => `- **${c.field}**: ${c.oldValue} → ${c.newValue} (changed by @${c.actor})`)
      .join('\n');
    core.info(`Posting field-change comment on ${item.repo}#${item.number}`);
    await botGithub.rest.issues.createComment({
      owner,
      repo,
      issue_number: item.number,
      body: `**Project field update**\n${body}`,
    });

    for (const c of itemChanges) changedFields.add(c.field);
  }

  return [...changedFields];
}
