"""
Unit tests for feed_parser.py

Tests feed parsing logic for RSS, Atom, HN, and Polymarket.
"""

import pytest
import sys
import os
from unittest.mock import Mock, patch
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from feed_parser import (
    parse_rss_feed,
    parse_hn_top_stories,
    parse_polymarket_markets,
    extract_feed_items,
    normalize_date
)


class TestRSSParsing:
    """Test RSS/Atom feed parsing."""

    def test_parse_arxiv_rss(self):
        """Test parsing arXiv RSS feed."""
        sample_rss = '''<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>http://arxiv.org/abs/2301.12345v1</id>
            <title>Test Paper Title</title>
            <summary>Test abstract</summary>
            <author><name>John Doe</name></author>
            <author><name>Jane Smith</name></author>
            <published>2023-01-15T10:00:00Z</published>
            <link href="http://arxiv.org/abs/2301.12345v1" rel="alternate" type="text/html"/>
            <link href="http://arxiv.org/pdf/2301.12345v1" rel="related" type="application/pdf"/>
            <category term="cs.AI"/>
            <category term="cs.LG"/>
          </entry>
        </feed>'''

        items = parse_rss_feed(sample_rss, source='arxiv')

        assert len(items) == 1
        item = items[0]

        assert item['title'] == 'Test Paper Title'
        assert 'John Doe' in item['authors']
        assert 'Jane Smith' in item['authors']
        assert item['link'] == 'http://arxiv.org/abs/2301.12345v1'
        assert 'cs.AI' in item['categories']

    def test_parse_rss_2_0_format(self):
        """Test parsing RSS 2.0 format."""
        sample_rss = '''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test Article</title>
              <link>https://example.com/article</link>
              <description>Article description</description>
              <pubDate>Mon, 15 Jan 2023 10:00:00 GMT</pubDate>
              <author>author@example.com (Author Name)</author>
            </item>
          </channel>
        </rss>'''

        items = parse_rss_feed(sample_rss, source='example')

        assert len(items) == 1
        assert items[0]['title'] == 'Test Article'
        assert items[0]['link'] == 'https://example.com/article'

    def test_parse_malformed_rss(self):
        """Test handling of malformed RSS."""
        malformed_rss = '<rss><channel><item><title>Incomplete'

        # Should return empty list, not crash
        items = parse_rss_feed(malformed_rss, source='test')
        assert items == []

    def test_parse_empty_feed(self):
        """Test parsing feed with no items."""
        empty_rss = '''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>Empty Feed</title>
          </channel>
        </rss>'''

        items = parse_rss_feed(empty_rss, source='test')
        assert items == []


class TestHNParsing:
    """Test Hacker News API parsing."""

    @patch('requests.get')
    def test_parse_hn_top_stories(self, mock_get):
        """Test parsing HN top stories."""
        # Mock HN API responses
        mock_get.side_effect = [
            # First call: get story IDs
            Mock(status_code=200, json=lambda: [12345, 12346]),
            # Second call: get story 12345
            Mock(status_code=200, json=lambda: {
                'id': 12345,
                'title': 'Show HN: My Cool Project',
                'url': 'https://example.com/project',
                'by': 'username',
                'time': 1673784000,
                'score': 150,
                'descendants': 42
            }),
            # Third call: get story 12346
            Mock(status_code=200, json=lambda: {
                'id': 12346,
                'title': 'Ask HN: What are you working on?',
                'url': None,  # Ask HN has no URL
                'by': 'asker',
                'time': 1673784100,
                'score': 80,
                'descendants': 120
            })
        ]

        items = parse_hn_top_stories(limit=2)

        assert len(items) == 2

        # Check first story
        assert items[0]['title'] == 'Show HN: My Cool Project'
        assert items[0]['link'] == 'https://example.com/project'
        assert items[0]['score'] == 150

        # Check Ask HN story (should have HN link)
        assert items[1]['title'] == 'Ask HN: What are you working on?'
        assert 'news.ycombinator.com' in items[1]['link']

    @patch('requests.get')
    def test_parse_hn_handles_missing_fields(self, mock_get):
        """Test HN parsing with missing optional fields."""
        mock_get.side_effect = [
            Mock(status_code=200, json=lambda: [12345]),
            Mock(status_code=200, json=lambda: {
                'id': 12345,
                'title': 'Minimal Story',
                'by': 'author',
                'time': 1673784000
                # Missing: url, score, descendants
            })
        ]

        items = parse_hn_top_stories(limit=1)

        assert len(items) == 1
        assert items[0]['title'] == 'Minimal Story'
        # Should have default values for missing fields


class TestPolymarketParsing:
    """Test Polymarket API parsing."""

    @patch('requests.get')
    def test_parse_polymarket_markets(self, mock_get):
        """Test parsing Polymarket markets."""
        mock_get.return_value = Mock(
            status_code=200,
            json=lambda: [
                {
                    'id': 'market1',
                    'question': 'Will X happen by 2025?',
                    'description': 'Market description',
                    'end_date': '2025-01-01T00:00:00Z',
                    'outcomes': ['Yes', 'No'],
                    'outcome_prices': ['0.65', '0.35'],
                    'volume': '1000000'
                }
            ]
        )

        items = parse_polymarket_markets()

        assert len(items) == 1
        item = items[0]

        assert item['title'] == 'Will X happen by 2025?'
        assert 'Yes: 0.65' in item['description'] or '65%' in item['description']

    @patch('requests.get')
    def test_parse_polymarket_api_error(self, mock_get):
        """Test handling Polymarket API errors."""
        mock_get.return_value = Mock(status_code=500)

        items = parse_polymarket_markets()

        # Should return empty list on error
        assert items == []


class TestDateNormalization:
    """Test date parsing and normalization."""

    def test_normalize_iso_date(self):
        """Test normalizing ISO 8601 dates."""
        iso_date = '2023-01-15T10:30:00Z'
        normalized = normalize_date(iso_date)

        assert isinstance(normalized, datetime)
        assert normalized.year == 2023
        assert normalized.month == 1
        assert normalized.day == 15

    def test_normalize_rfc_822_date(self):
        """Test normalizing RFC 822 dates (RSS)."""
        rfc_date = 'Mon, 15 Jan 2023 10:30:00 GMT'
        normalized = normalize_date(rfc_date)

        assert isinstance(normalized, datetime)
        assert normalized.year == 2023
        assert normalized.month == 1
        assert normalized.day == 15

    def test_normalize_unix_timestamp(self):
        """Test normalizing Unix timestamps."""
        timestamp = 1673784000  # 2023-01-15
        normalized = normalize_date(timestamp)

        assert isinstance(normalized, datetime)
        assert normalized.year == 2023

    def test_normalize_invalid_date(self):
        """Test handling invalid date formats."""
        # Should return None or current date
        result = normalize_date('invalid date')

        # Implementation-specific: may return None or fallback
        assert result is None or isinstance(result, datetime)


class TestFeedExtraction:
    """Test high-level feed extraction."""

    @patch('requests.get')
    def test_extract_feed_items_arxiv(self, mock_get):
        """Test extracting items from arXiv."""
        sample_rss = '''<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <title>Test Paper</title>
            <id>http://arxiv.org/abs/2301.12345</id>
            <link href="http://arxiv.org/abs/2301.12345"/>
            <published>2023-01-15T10:00:00Z</published>
          </entry>
        </feed>'''

        mock_get.return_value = Mock(
            status_code=200,
            text=sample_rss,
            content=sample_rss.encode('utf-8')
        )

        items = extract_feed_items(
            source='arxiv',
            url='http://export.arxiv.org/rss/cs.AI'
        )

        assert len(items) > 0
        assert items[0]['source'] == 'arxiv'

    @patch('requests.get')
    def test_extract_feed_items_network_error(self, mock_get):
        """Test handling network errors."""
        mock_get.side_effect = Exception('Network error')

        items = extract_feed_items(
            source='test',
            url='https://example.com/feed'
        )

        # Should return empty list on error
        assert items == []

    @patch('requests.get')
    def test_extract_feed_items_timeout(self, mock_get):
        """Test handling request timeouts."""
        import requests
        mock_get.side_effect = requests.Timeout('Request timeout')

        items = extract_feed_items(
            source='test',
            url='https://example.com/feed',
            timeout=5
        )

        assert items == []


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_parse_rss_with_html_entities(self):
        """Test parsing RSS with HTML entities in content."""
        rss_with_entities = '''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test &amp; Example</title>
              <description>Content with &lt;tags&gt;</description>
              <link>https://example.com/1</link>
            </item>
          </channel>
        </rss>'''

        items = parse_rss_feed(rss_with_entities, source='test')

        # HTML entities should be decoded
        assert items[0]['title'] == 'Test & Example'
        assert '<tags>' in items[0]['description'] or '&lt;tags&gt;' in items[0]['description']

    def test_parse_rss_with_cdata(self):
        """Test parsing RSS with CDATA sections."""
        rss_with_cdata = '''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title><![CDATA[Title with <html>]]></title>
              <description><![CDATA[Description with special chars: & < >]]></description>
              <link>https://example.com/1</link>
            </item>
          </channel>
        </rss>'''

        items = parse_rss_feed(rss_with_cdata, source='test')

        assert len(items) == 1
        # CDATA content should be properly extracted

    def test_parse_feed_with_missing_required_fields(self):
        """Test parsing feed items missing required fields."""
        incomplete_rss = '''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <!-- Missing title and link -->
              <description>Has description but no title</description>
            </item>
          </channel>
        </rss>'''

        items = parse_rss_feed(incomplete_rss, source='test')

        # Should skip items missing required fields
        # or use fallback values
        # (implementation-specific)

    def test_parse_very_large_feed(self):
        """Test parsing feed with many items."""
        # Generate RSS with 1000 items
        items_xml = '\n'.join([
            f'''<item>
              <title>Item {i}</title>
              <link>https://example.com/{i}</link>
              <pubDate>Mon, 15 Jan 2023 10:00:00 GMT</pubDate>
            </item>'''
            for i in range(1000)
        ])

        large_rss = f'''<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            {items_xml}
          </channel>
        </rss>'''

        items = parse_rss_feed(large_rss, source='test')

        # Should handle large feeds without crashing
        assert len(items) == 1000

    def test_parse_feed_with_unicode(self):
        """Test parsing feed with Unicode characters."""
        unicode_rss = '''<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Test with émojis 🚀 and ñoñ-ASCII</title>
              <link>https://example.com/unicode</link>
              <description>Description with 中文 and Русский</description>
            </item>
          </channel>
        </rss>'''

        items = parse_rss_feed(unicode_rss, source='test')

        assert len(items) == 1
        # Unicode should be preserved
        assert '🚀' in items[0]['title'] or 'rocket' in items[0]['title'].lower()
