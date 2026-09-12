# News Bulletin Bot - Enhancement Proposal

**Project:** hafizn24-cronjob (Telegram News Bulletin Bot)  
**Date:** September 12, 2026  
**Author:** Hafiz N24  
**Version:** 1.0.0 → 2.0.0

---

## Executive Summary

This document outlines a strategic proposal to enhance the existing Telegram News Bulletin Bot by improving news acquisition, diversifying data sources, and enhancing the overall output quality. The proposed changes aim to deliver more comprehensive, timely, and visually engaging news bulletins while maintaining the current architecture viability.

---

## Current System Analysis

### Architecture Overview

The current system is a single-file Node.js application (src/news-cron.js, 494 lines) that performs the following workflow:

| Step | Description | Location |
|------|-------------|----------|
| 1 | Fetch Google News RSS feeds (World, Malaysia, Football, Economic) | Lines 214-223 |
| 2 | Parse RSS feeds using fast-xml-parser | Lines 232-250 |
| 2b | Fallback to GNews API if articles missing | Lines 252-301 |
| 3 | Build formatted news text for AI | Lines 303-321 |
| 4 | Generate HTML bulletin & voice script via Gemini AI | Lines 323-414 |
| 5 | Synthesize MP3 audio via gTTS | Lines 415-432 |
| 6 | Send to Telegram | Lines 434-462 |
| 7 | Send log file to Telegram | Lines 464-470 |

### Current Data Sources

| Source | Type | Coverage | Limitations |
|--------|------|----------|-------------|
| Google News RSS | Primary | 4 categories (World, Malaysia, Football, Economic) | Fixed topics, limited filtering |
| GNews API | Fallback | General news coverage | API key dependent, limited articles per request |
| GitHub Actions | Workflow Runner | Automated execution | Required for scheduled/manual runs |

### Identified Issues

1. Limited News Categories - Only 4 predefined categories
2. No External Images - Articles lack associated images
3. Incomplete Metadata - Missing author names, full descriptions
4. Duplicate Prevention - No deduplication mechanism
5. Static Configuration - All settings hardcoded in single file
6. Basic TTS - gTTS may lack voice variety and intonation control
7. Single Data Feed Dependency - Reliance on one primary source with basic fallback
8. No Weather Integration - Potential missing context for daily bulletins
9. GitHub Actions Dependency - Reliance on GitHub Actions for execution (may limit deployment flexibility)

---

## Proposed Enhancements

### Phase 1: Code Improvements (Priority: High)

#### 1.1 Improve RSS Parsing Function

**Objective:** Enhance the RSS parsing to extract more metadata from articles.

**Current Issues:**
- RSS parser does not extract author names
- Missing content snippets from articles
- No image URL extraction

**Proposed Changes to `parseRSS()` function (lines 72-93):**

```javascript
function parseRSS(xmlData) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(xmlData);

  const items = parsed.rss?.channel?.item || [];
  const itemsArray = Array.isArray(items) ? items : [items];

  return itemsArray.slice(0, 3).map(item => {
    let source = item.source;
    if (typeof source === 'object' && source['#text']) {
      source = source['#text'];
    }

    return {
      title:       item.title       || 'N/A',
      url:         item.link        || 'N/A',
      description: item.description || 'N/A',
      content:     item.content     || '', // Add content snippet
      author:      item.creator     || 'Unknown', // Add author
      source:      source           || 'Google News',
      publishedAt: item.pubDate     || 'N/A',
      image:       item['media:content']?.url || '' // Add image URL if available
    };
  });
}
```

**Updated Article Structure:**
```javascript
{
  title:       article.title       || 'N/A',
  url:         article.url         || 'N/A',
  description: article.description || 'N/A',
  content:     article.content     || '', // New: content snippet
  author:      article.author      || 'Unknown', // New: author name
  source:      sourceName         || 'Google News',
  publishedAt: article.publishedAt || 'N/A',
  image:       article.urlToImage  || '' // New: image URL
}
```

#### 1.2 Enhance GNews Fallback Parser

**Objective:** Improve the GNews API response parser to handle additional fields.

**Proposed Changes to `parseGNews()` function (lines 95-104):**

```javascript
function parseGNews(response) {
  const articles = response.articles || [];
  return articles.slice(0, 3).map(article => ({
    title:       article.title       || 'N/A',
    url:         article.url         || 'N/A',
    description: article.description || 'N/A',
    content:     article.content     || '', // Add content snippet
    author:      article.author      || 'Unknown', // Add author
    source:      article.source?.name || 'GNews',
    publishedAt: article.publishedAt || 'N/A',
    image:       article.image       || '' // Add image URL
  }));
}
```

#### 1.3 Add Article Deduplication

**Objective:** Prevent duplicate headlines in the bulletin output.

**Implementation:**

Add deduplication function and integrate into the news fetching process.

```javascript
function dedupeArticles(articles, previousArticles = []) {
  const existingTitles = new Set(previousArticles.map(a => a.title?.toLowerCase?.() || ''));
  return articles.filter(a => {
    const title = a.title?.toLowerCase?.() || '';
    return !existingTitles.has(title);
  });
}
```

**Integration point:** Call `dedupeArticles()` after fetching articles but before building `newsText`.

### Phase 2: Output Enhancement (Priority: High)

#### 2.1 Improved Article Metadata

**Objective:** Enrich article data with available metadata.

**Changes:**
- Extract author field from article objects
- Include urlToImage for article thumbnails
- Add content snippet for better context (up to 200 characters)
- Format descriptions for better readability

**Modified Article Structure:**

```javascript
{
  title: article.title || 'N/A',
  url: article.url || 'N/A',
  description: article.description || 'N/A',
  content: article.content || '', // Optional snippet
  author: article.author || 'Unknown',
  source: sourceName || 'Unknown',
  publishedAt: article.publishedAt || 'N/A',
  image: article.urlToImage || '' // Add image URL
}
```

#### 2.2 Enhanced Gemini Prompts

**Objective:** Improve generated bulletin output quality by optimizing the prompts in `news-cron.js` (lines 330-383).

**Proposed Changes to Text Prompt:**

Modify the text prompt to:
1. Request concise article summaries (1-2 sentences)
2. Include break for breaking news sections
3. Maintain clear visual separation between sections
4. Emphasize article metadata integration (author, source)

**Sample Enhanced Text Prompt:**

```javascript
const textPrompt = `You are a professional news editor writing a Telegram bulletin using Telegram HTML format.

STRICT RULES:
- Telegram only supports: <b>, <i>, <a href="...">, <code>
- Use \\n for line breaks ONLY - no <br>, <hr>, <ul>, <li>
- Output plain text with \\n line breaks and allowed HTML tags
- Do NOT wrap output in code blocks or quotes
- For sections with no articles: "No articles available for this section."
- Do NOT invent, fabricate, or assume any news.
- Include article author where available in the source link.

FORMAT:
<b>📰 Daily News Bulletin</b>
<i>🕗 ${sentAt} MYT</i>

— — — — — — — — — — — — —
<b>🌍 GLOBAL</b>
— — — — — — — — — — — — —
<b>Breaking News:</b>
[breaking articles in bold]
<b>Headlines:</b>
[other articles in bold]
<a href="[article URL]">📎 [Source Name]</a>
— — — — — — — — — — — — —
[binary for MALAYSIA, FOOTBALL, ECONOMIC]
— — — — — — — — — — — — —
<i>🎙 Audio bulletin attached · Stay informed daily</i>

News articles with metadata:
${newsText}
`;
```

**Proposed Changes to Voice Script Prompt:**

Modify the voice prompt (`lines 385-401`) to:
1. Make script more conversational (5-8 minutes instead of 8-10)
2. Add natural transition phrases
3. Include emphasis markers where appropriate
4. Optimize for better gTTS pronunciation

#### 2.3 Image Integration

**Objective:** Include article images in the Telegram bulletin where available.

**Changes to `news-cron.js`:**

1. **Update Article Structure** (lines 85-91, 97-103) to include image URL
2. **Modify Gemini Prompt** to include image URLs in article descriptions
3. **Telegram HTML Support** - Use Telegram's HTML parser:
   - `<img>` tag may or may not render depending on Telegram version
   - Alternative: Include image preview text with image URL

**Implementation Notes:**
```javascript
// In newsText construction, include image URL:
newsText += `   Image: ${article.image}\n` if article.image;
```

### Phase 3: Additional Code Improvements (Priority: Medium)

### Phase 3: Additional Features (Priority: Medium)

#### 3.1 Category Expansion

**Objective:** Add additional news categories to broaden coverage.

**Proposed Categories:**
- Technology
- Health
- Science
- Entertainment

#### 3.2 Weather Integration (Optional)

**Objective:** Add weather information to the bulletin for contextual relevance.

**Rationale:**
- Weather is relevant to daily news consumption
- WeatherAPI.com offers free tier (free for non-commercial use)
- Can be added as a separate Weather section

#### 3.3 Article Deduplication

**Objective:** Prevent duplicate headlines in the bulletin.

**Implementation:**
- Create a simple hash/set of detected titles
- Compare incoming articles against existing cache
- Remove duplicates before sending to Gemini

#### 3.4 Configuration Flexibility

**Objective:** Extract hardcoded values for better maintainability.

**Changes:**
- Extract RSS URLs from `run()` function into constants
- Create constants for article limits
- Extract Gemini prompt into separate variable or external file

### Phase 4: Code Architecture Improvements (Priority: Low)

#### 4.1 Code Organization Improvements

**Objective:** Improve code readability and maintainability without restructuring entirely.

**Proposed Changes:**
- Add clean function separators and comments
- Extract magic numbers (retry counts, delays) into constants
- Add documentation comments to functions

---

## Implementation Timeline

### Phase 1: Code Improvements (2-3 days)
- [ ] Enhance RSS parser to extract metadata (author, content, image)
- [ ] Enhance GNews parser to extract additional fields
- [ ] Add article deduplication function
- [ ] Integrate deduplication into news fetching flow
- [ ] Update Gemini prompts for better output
- [ ] Testing and debugging

### Phase 2: Output Enhancement (2-3 days)
- [ ] Modify article structure in newsText building
- [ ] Enhance Gemini text prompt
- [ ] Enhance Gemini voice script prompt
- [ ] Test improved output formatting
- [ ] Testing and debugging

### Phase 3: Additional Improvements (2-3 days)
- [ ] Implement image integration in prompts
- [ ] Extract hardcoded values to constants
- [ ] Add improved error handling
- [ ] Test all changes together
- [ ] Testing and debugging

**Total Estimated Time:** 6-9 days

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API key exposure | Low | High | Use environment variables; never commit API keys |
| Gemini API changes | Medium | Medium | Monitor API updates; use stable model versions |
| Duplicate headlines | High | Low | Implement deduplication logic |
| Performance degradation | Low | Medium | Optimize API calls; add caching if needed |
| Image display issues | Medium | Low | Use fallback text format when images unavailable |
| RSS parsing errors | Medium | Low | Robust error handling in parser |

---

## Dependencies

### New Dependencies (if needed)
- axios - For NewsAPI requests (may use native https)
- node-cache - For caching articles

### Existing Dependencies (unchanged)
- @google/genai (^2.8.0) - Gemini AI
- fast-xml-parser (^5.8.0) - RSS parsing
- gtts (^0.2.1) - Text-to-Speech
- form-data (^4.0.0) - Telegram file uploads

---

## Environment Variables (Current Configuration)

The following environment variables are already configured in `.env`:

```env
# GitHub Actions Configuration
GITHUB_TOKEN=your_github_token_here
GITHUB_OWNER=hafizn24
GITHUB_REPO=hafizn24-cronjob

# API Keys for News and AI Services
GEMINI_API_KEY=your_gemini_api_key_here
GNEWS_API_KEY=your_gnews_api_key_here

# Telegram Configuration
TELEGRAM_TOKEN=your_telegram_token_here
TELEGRAM_CHAT_ID=@your_chat_id_here
```

**Note:** Replace placeholders with actual values before deployment.

### Notes:
- All existing API keys are already in place and should remain unchanged
- No new API key acquisition is required for these improvements
- The improvements below will work with current existing infrastructure

---

## Testing Strategy

### Unit Testing
- Test RSS parsing functions
- Test NewsAPI integration
- Test Gemini prompt generation
- Test deduplication logic

### Integration Testing
- Test full workflow with combined data sources
- Test Telegram message formatting
- Test audio generation and upload
- Test error scenarios

### Manual Testing
- Run full bulletin generation
- Verify sent messages in Telegram
- Check audio playback quality
- Validate visual formatting

---

## Success Metrics

After implementation, evaluate:

1. Coverage: Number of unique articles per bulletin
2. Quality: Article relevance and completeness
3. Deliverability: Successful message sends
4. Response Time: Time from trigger to finished bulletin
5. User Feedback: Reception of enhanced bulletins
6. Error Rate: Frequency of failures and retries

---

## Conclusion

This enhancement proposal focuses on improving the existing Telegram News Bulletin Bot through code improvements that work with your existing API keys and infrastructure.

### Summary of Proposed Changes:

| Area | Changes | No New APIs Required |
|------|---------|----------------------|
| **Phase 1: Code Improvements** | Enhanced RSS/GNews parsers, article deduplication | ✅ |
| **Phase 2: Output Enhancement** | Optimized Gemini prompts, image integration | ✅ |
| **Phase 3: Additional Improvements** | Extract constants, improve error handling | ✅ |

### What Will NOT Be Added:
- ❌ No new API keys required (all existing keys work with modifications)
- ❌ No NewsAPI.org integration
- ❌ No Weather API integration
- ❌ No additional NPM dependencies
- ❌ No new infrastructure or services

### Key Improvements That Work with Existing APIs:

1. **Better Article Metadata** - Extract available fields from Google News RSS and GNews API (already using these)
2. **Cleaner Output Formatting** - Optimize Gemini prompts with existing GEMINI_API_KEY
3. **Improved Audio Script** - Enhance gTTS prompts with existing configuration
4. **Deduplication Logic** - Pure JavaScript, no external library needed

### Estimated Impact:
- **Timeline:** 6-9 days (reduced from original estimate)
- **Risk:** Lower (no new APIs, no infrastructure changes)
- **Backward Compatibility:** Fully maintained
- **API Key Usage:** Unchanged

All improvements will work with your current `.env` configuration:
- `GEMINI_API_KEY` - Used for enhanced prompt optimization
- `GNEWS_API_KEY` - Used for better metadata extraction
- Existing Telegram and GitHub Actions configurations

The phased approach allows for incremental implementation while maintaining full backward compatibility.

---

## Appendix A: Technical Specifications

### Current System
- Platform: Node.js
- Runtime: Serverless (GitHub Actions)
- Node Version: 20
- Architecture: Single file (494 lines)

### Existing API Keys (No Changes Required)
| API | Environment Variable | Status |
|-----|---------------------|--------|
| Google Gemini | GEMINI_API_KEY | Active |
| GNews | GNEWS_API_KEY | Active |
| Telegram Bot | TELEGRAM_TOKEN | Active |

### Dependencies (No Changes Required)
- `@google/genai` (^2.8.0) - Gemini AI
- `fast-xml-parser` (^5.8.0) - RSS parsing
- `gtts` (^0.2.1) - Text-to-Speech
- `form-data` (^4.0.0) - Telegram file uploads
