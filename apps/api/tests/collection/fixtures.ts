/** Flux et réponses SYNTHÉTIQUES (rédigés pour les tests, aucun contenu tiers). */
export const LONG_TEXT = 'Synthetic release notes describing version 2.0 of a fictional library, with a new API, typed forms and a migration guide. '.repeat(12);

export const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Synthetic feed</title><link>https://feed.example/</link><description>Synthetic</description>
<item><title>Fictional Library 2.0 released</title><link>https://feed.example/posts/fictional-2?utm_source=rss&amp;utm_medium=feed</link>
<guid isPermaLink="false">post-2</guid><pubDate>Wed, 04 Nov 2026 09:00:00 GMT</pubDate><category>Releases</category>
<description>Short synthetic summary of the release.</description><content:encoded><![CDATA[<p>${LONG_TEXT}</p>]]></content:encoded></item>
<item><title>Older synthetic post</title><link>https://feed.example/posts/older</link><guid isPermaLink="false">post-1</guid>
<pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate><description>Tiny.</description></item>
</channel></rss>`;

export const GITHUB_RELEASES = JSON.stringify([
  { id: 2002, name: 'v2.0.0', tag_name: 'v2.0.0', html_url: 'https://github.com/example/lib/releases/tag/v2.0.0', published_at: '2026-11-05T10:00:00Z', created_at: '2026-11-05T09:00:00Z', body: LONG_TEXT, draft: false, prerelease: false, author: { login: 'bot' } },
  { id: 2001, name: null, tag_name: 'v2.0.0-rc.1', html_url: 'https://github.com/example/lib/releases/tag/v2.0.0-rc.1', published_at: '2026-11-01T10:00:00Z', created_at: '2026-11-01T09:00:00Z', body: 'RC notes.', draft: false, prerelease: true, author: null },
  { id: 2000, name: 'draft', tag_name: 'v3', html_url: 'https://github.com/example/lib/releases/tag/v3', published_at: null, created_at: '2026-11-06T09:00:00Z', body: 'draft', draft: true, prerelease: false },
]);
