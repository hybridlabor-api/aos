---
name: firecrawl-build
description: >-
  Integrate Firecrawl into product code for web scraping, crawling, searching, and interaction.
  Use this skill when an application needs to access web data, extract content, or automate web interactions.
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl *)
---
# Firecrawl Build

This skill enables the integration of Firecrawl into product code for web scraping, crawling, searching, and interaction.

## Usage

To use this skill, ensure you have the Firecrawl CLI installed and authenticated. You can then use the following commands to integrate Firecrawl into your application:

*   `firecrawl scrape <URL>`: Extract content from a specified URL.
*   `firecrawl crawl <URL>`: Crawl an entire website or a specific section.
*   `firecrawl search <query>`: Search the web for specific content.
*   `firecrawl interact <URL>`: Interact with a webpage, such as clicking buttons or filling out forms.

## Examples

*   "Scrape the content from https://example.com"
    `firecrawl scrape https://example.com --format markdown`
*   "Crawl the /docs section of example.com"
    `firecrawl crawl https://example.com --include-paths /docs --wait -o docs.json`
*   "Search for recent news on AI"
    `firecrawl search "recent news on AI" --limit 5`
*   "Interact with the login form on https://example.com/login"
    `firecrawl interact https://example.com/login --prompt "Fill in the email field with user@example.com and click the login button"`

## See Also

*   [firecrawl-build-scrape](../firecrawl-build-scrape/SKILL.md)
*   [firecrawl-build-search](../firecrawl-build-search/SKILL.md)
*   [firecrawl-build-interact](../firecrawl-build-interact/SKILL.md)