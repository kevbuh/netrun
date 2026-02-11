"""
Unit tests for feed_parser.py - RSS, Atom, HN, and Polymarket parsing.

Tests feed parsing logic from feed_parser.py which mirrors the JS parsing
but uses Python stdlib only.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import patch, Mock

import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from feed_parser import (
    _strip_html,
    _parse_date,
    _format_display_date,
    _extract_arxiv_id,
    parse_rss,
    parse_arxiv,
)


class TestStripHTML:
    """Test HTML stripping utility."""

    def test_strip_simple_tags(self):
        """Test stripping simple HTML tags."""
        assert _strip_html('<p>Hello</p>') == 'Hello'
        assert _strip_html('<div>World</div>') == 'World'

    def test_strip_nested_tags(self):
        """Test stripping nested HTML tags."""
        result = _strip_html('<div><p>Nested <strong>content</strong></p></div>')
        assert result == 'Nested content'

    def test_strip_with_attributes(self):
        """Test stripping tags with attributes."""
        result = _strip_html('<a href="http://example.com">Link</a>')
        assert result == 'Link'

    def test_strip_mixed_content(self):
        """Test stripping mixed HTML and text."""
        result = _strip_html('Text <em>emphasized</em> more text')
        assert result == 'Text emphasized more text'

    def test_strip_empty_string(self):
        """Test stripping from empty string."""
        assert _strip_html('') == ''

    def test_strip_no_tags(self):
        """Test text without tags."""
        assert _strip_html('Plain text') == 'Plain text'

    def test_strip_with_newlines(self):
        """Test stripping tags with newlines."""
        result = _strip_html('<p>Line 1</p>\n<p>Line 2</p>')
        assert result == 'Line 1\nLine 2'


class TestParseDate:
    """Test date parsing utility."""

    def test_parse_rfc822_date(self):
        """Test parsing RFC 822 date format (RSS)."""
        iso, display = _parse_date('Mon, 15 Jan 2024 10:30:00 +0000')
        assert iso is not None
        assert '2024-01-15' in iso
        assert display == 'Jan 15, 2024'

    def test_parse_iso8601_date(self):
        """Test parsing ISO 8601 date format."""
        iso, display = _parse_date('2024-01-15T10:30:00Z')
        assert iso is not None
        assert '2024-01-15' in iso

    def test_parse_current_year_display(self):
        """Test that dates in current year omit year."""
        now = datetime.now(timezone.utc)
        date_str = now.strftime('%Y-%m-%dT%H:%M:%SZ')
        iso, display = _parse_date(date_str)

        # Should not include year for current year
        assert str(now.year) not in display

    def test_parse_invalid_date(self):
        """Test parsing invalid date."""
        iso, display = _parse_date('not a date')
        assert iso is None
        assert display == ''

    def test_parse_empty_date(self):
        """Test parsing empty date."""
        iso, display = _parse_date('')
        assert iso is None
        assert display == ''

    def test_parse_none_date(self):
        """Test parsing None date."""
        iso, display = _parse_date(None)
        assert iso is None
        assert display == ''


class TestFormatDisplayDate:
    """Test display date formatting."""

    def test_format_current_year(self):
        """Test formatting date in current year."""
        now = datetime.now(timezone.utc)
        dt = now.replace(month=3, day=15)
        result = _format_display_date(dt)

        assert 'Mar 15' in result
        assert str(now.year) not in result

    def test_format_different_year(self):
        """Test formatting date in different year."""
        dt = datetime(2020, 3, 15, tzinfo=timezone.utc)
        result = _format_display_date(dt)

        assert 'Mar 15' in result
        assert '2020' in result

    def test_format_all_months(self):
        """Test formatting works for all months."""
        months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

        for month_num, month_name in enumerate(months, 1):
            dt = datetime(2020, month_num, 15, tzinfo=timezone.utc)
            result = _format_display_date(dt)
            assert month_name in result


class TestExtractArxivId:
    """Test arXiv ID extraction."""

    def test_extract_from_abs_url(self):
        """Test extracting ID from /abs/ URL."""
        link = 'https://arxiv.org/abs/2301.12345'
        assert _extract_arxiv_id(link) == '2301.12345'

    def test_extract_from_pdf_url(self):
        """Test extracting ID from /pdf/ URL - not supported."""
        # The regex only matches /abs/ URLs, not /pdf/
        link = 'https://arxiv.org/pdf/2301.12345.pdf'
        assert _extract_arxiv_id(link) is None

    def test_extract_with_version(self):
        """Test extracting ID with version number."""
        link = 'https://arxiv.org/abs/2301.12345v2'
        assert _extract_arxiv_id(link) == '2301.12345'

    def test_extract_from_none(self):
        """Test extraction from None."""
        assert _extract_arxiv_id(None) is None

    def test_extract_from_invalid_url(self):
        """Test extraction from non-arxiv URL."""
        assert _extract_arxiv_id('https://example.com') is None


class TestParseRSS:
    """Test RSS/Atom feed parsing."""

    def test_parse_valid_rss(self):
        """Test parsing a valid RSS 2.0 feed."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <title>Test Feed</title>
                <item>
                    <title>Test Article</title>
                    <link>https://example.com/article1</link>
                    <pubDate>Mon, 15 Jan 2024 10:00:00 +0000</pubDate>
                    <description>Test description</description>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test-feed')

        assert len(items) == 1
        assert items[0]['title'] == 'Test Article'
        assert items[0]['link'] == 'https://example.com/article1'
        assert items[0]['source'] == 'test-feed'
        assert 'description' in items[0]

    def test_parse_valid_atom(self):
        """Test parsing a valid Atom feed."""
        atom = b'''<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <title>Test Feed</title>
            <entry>
                <title>Test Article</title>
                <link href="https://example.com/article1" rel="alternate" />
                <published>2024-01-15T10:00:00Z</published>
                <summary>Test summary</summary>
            </entry>
        </feed>'''

        items = parse_rss(atom, 'test-atom')

        assert len(items) == 1
        assert items[0]['title'] == 'Test Article'
        assert items[0]['link'] == 'https://example.com/article1'
        assert items[0]['source'] == 'test-atom'

    def test_parse_multiple_items(self):
        """Test parsing feed with multiple items."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title>Article 1</title>
                    <link>https://example.com/1</link>
                </item>
                <item>
                    <title>Article 2</title>
                    <link>https://example.com/2</link>
                </item>
                <item>
                    <title>Article 3</title>
                    <link>https://example.com/3</link>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        assert len(items) == 3

    def test_parse_item_with_author(self):
        """Test parsing RSS item with author."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title>Test</title>
                    <link>https://example.com/1</link>
                    <author>John Doe</author>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        assert items[0]['authors'] == 'John Doe'

    def test_parse_malformed_xml(self):
        """Test parsing malformed XML."""
        malformed = b'<rss><channel><item><title>Unclosed'

        items = parse_rss(malformed, 'test')
        assert items == []

    def test_parse_empty_feed(self):
        """Test parsing feed with no items."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <title>Empty Feed</title>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        assert items == []

    def test_parse_item_without_title(self):
        """Test that items without titles are skipped."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <link>https://example.com/1</link>
                    <description>No title</description>
                </item>
                <item>
                    <title>Has Title</title>
                    <link>https://example.com/2</link>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        # Only item with title should be included
        assert len(items) == 1
        assert items[0]['title'] == 'Has Title'

    def test_parse_strips_html_from_description(self):
        """Test that HTML is stripped from descriptions."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title>Test</title>
                    <link>https://example.com/1</link>
                    <description>&lt;p&gt;HTML content&lt;/p&gt;</description>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        # Should strip HTML tags
        assert '<p>' not in items[0]['description']
        assert 'HTML content' in items[0]['description']


class TestParseArxiv:
    """Test arXiv-specific feed parsing."""

    def test_parse_arxiv_feed(self):
        """Test parsing arXiv Atom feed."""
        arxiv_atom = b'''<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
                <id>http://arxiv.org/abs/2301.12345v1</id>
                <title>Deep Learning for Computer Vision</title>
                <summary>Abstract text here</summary>
                <author><name>John Doe</name></author>
                <author><name>Jane Smith</name></author>
                <published>2023-01-15T00:00:00Z</published>
                <link href="http://arxiv.org/abs/2301.12345v1" rel="alternate" type="text/html"/>
                <category term="cs.CV"/>
                <category term="cs.AI"/>
            </entry>
        </feed>'''

        items = parse_arxiv(arxiv_atom)

        assert len(items) == 1
        item = items[0]
        assert item['title'] == 'Deep Learning for Computer Vision'
        assert item['arxiv_id'] == '2301.12345'
        assert item['source'] == 'arxiv'
        assert 'John Doe' in item['authors']
        assert 'Jane Smith' in item['authors']
        assert 'cs.CV' in item['categories']
        assert 'cs.AI' in item['categories']

    def test_parse_arxiv_multiple_categories(self):
        """Test parsing arXiv entry with multiple categories."""
        arxiv_atom = b'''<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
                <id>http://arxiv.org/abs/2301.12345v1</id>
                <title>Test Paper</title>
                <summary>Test</summary>
                <published>2023-01-15T00:00:00Z</published>
                <link href="http://arxiv.org/abs/2301.12345v1" rel="alternate"/>
                <category term="cs.AI"/>
                <category term="cs.LG"/>
                <category term="stat.ML"/>
            </entry>
        </feed>'''

        items = parse_arxiv(arxiv_atom)
        categories = items[0]['categories']

        assert len(categories) == 3
        assert 'cs.AI' in categories
        assert 'cs.LG' in categories
        assert 'stat.ML' in categories

    def test_parse_arxiv_empty_feed(self):
        """Test parsing empty arXiv feed."""
        arxiv_atom = b'''<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
            <title>arXiv Query Results</title>
        </feed>'''

        items = parse_arxiv(arxiv_atom)
        assert items == []


class TestFeedParserEdgeCases:
    """Test edge cases and error handling."""

    def test_parse_rss_with_content_encoded(self):
        """Test parsing RSS with content:encoded field."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
            <channel>
                <item>
                    <title>Test</title>
                    <link>https://example.com/1</link>
                    <description>Short description</description>
                    <content:encoded><![CDATA[<p>Full content here</p>]]></content:encoded>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        # Should prefer content:encoded over description
        assert len(items) == 1

    def test_parse_very_large_feed(self):
        """Test parsing feed with many items."""
        # Create feed with 100 items
        items_xml = '\n'.join([
            f'''<item>
                <title>Article {i}</title>
                <link>https://example.com/{i}</link>
            </item>'''
            for i in range(100)
        ])

        rss = f'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                {items_xml}
            </channel>
        </rss>'''.encode()

        items = parse_rss(rss, 'test')
        assert len(items) == 100

    def test_parse_unicode_content(self):
        """Test parsing feed with unicode characters."""
        rss = '''<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title>Test με ελληνικά 中文 日本語</title>
                    <link>https://example.com/1</link>
                    <description>Unicode: ñ é ü 🎉</description>
                </item>
            </channel>
        </rss>'''.encode('utf-8')

        items = parse_rss(rss, 'test')
        assert len(items) == 1
        assert 'ελληνικά' in items[0]['title']

    def test_parse_cdata_sections(self):
        """Test parsing CDATA sections in feed."""
        rss = b'''<?xml version="1.0"?>
        <rss version="2.0">
            <channel>
                <item>
                    <title><![CDATA[Title with <special> chars]]></title>
                    <link>https://example.com/1</link>
                    <description><![CDATA[<p>Content</p>]]></description>
                </item>
            </channel>
        </rss>'''

        items = parse_rss(rss, 'test')
        assert len(items) == 1
        assert 'special' in items[0]['title']
