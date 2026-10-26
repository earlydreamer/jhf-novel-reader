package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.net.URI;
import org.junit.Test;

public class SourceBrowserNoticeTest {
    private static final URI SITE = URI.create("https://syosetu.com/");

    @Test public void blockedOrFailingSiteResponsesExplainTheCause() {
        for (int status : new int[] { 403, 429, 500, 502, 503 }) {
            assertEquals(String.valueOf(status), SourceBrowserPolicy.SITE_UNAVAILABLE, SourceBrowserPolicy.mainFrameNotice(SITE, status));
        }
    }

    @Test public void ordinaryResponsesKeepTheDefaultGuidance() {
        for (int status : new int[] { 200, 204, 301, 404 }) {
            assertNull(String.valueOf(status), SourceBrowserPolicy.mainFrameNotice(SITE, status));
        }
    }

    @Test public void appDenialsOutsideSiteProfilesAreNotBlamedOnTheSite() {
        assertNull(SourceBrowserPolicy.mainFrameNotice(URI.create("https://127.0.0.1/"), 403));
    }
}
