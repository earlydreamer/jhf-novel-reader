package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.StringReader;
import java.util.concurrent.atomic.AtomicInteger;

@RunWith(AndroidJUnit4.class)
public class SiwcResponsesInstrumentedTest {
    private static String event(String type, JSONObject fields) throws Exception {
        return "event: " + type + "\r\ndata: " + fields.put("type", type).toString() + "\r\n\r\n";
    }
    private static String delta() throws Exception {
        return event("response.output_text.delta", new JSONObject().put("delta", "합성 수신 중"));
    }
    private static String completed(String id) throws Exception {
        JSONObject response = new JSONObject().put("id", id).put("status", "completed")
            .put("output", new JSONArray().put(new JSONObject().put("type", "message").put("role", "assistant")
                .put("content", new JSONArray().put(new JSONObject().put("type", "output_text").put("text", "합성 번역 완료")))))
            .put("usage", new JSONObject().put("input_tokens", 12).put("output_tokens", 7));
        return event("response.completed", new JSONObject().put("response", response));
    }
    private static SiwcResponses.Result consume(String text) throws Exception {
        return SiwcResponses.consume(new StringReader(text), () -> false, partial -> { }, android.os.SystemClock.elapsedRealtime());
    }
    private static void rejects(String text) throws Exception {
        try { consume(text); fail("incomplete stream accepted"); } catch (Exception expected) { }
    }

    @Test public void completedResponseIsRequiredAndFinalTextIsAuthoritative() throws Exception {
        AtomicInteger deltas = new AtomicInteger();
        String stream = ": keepalive\n\n" + event("response.created", new JSONObject().put("response", new JSONObject().put("id", "synthetic")))
            + delta() + completed("synthetic");
        SiwcResponses.Result result = SiwcResponses.consume(new StringReader(stream), () -> false,
            partial -> deltas.incrementAndGet(), android.os.SystemClock.elapsedRealtime());
        assertEquals("합성 번역 완료", result.text);
        assertEquals(1, deltas.get());
        assertEquals(12, result.inputTokens);
        assertEquals(7, result.outputTokens);
        assertTrue(result.firstMs >= 0);
        assertTrue(result.totalMs >= result.firstMs);
    }

    @Test public void lateFailureIncompleteErrorEofAndDoneNeverBecomeSuccess() throws Exception {
        for (String type : new String[]{"response.failed", "response.incomplete", "error"})
            rejects(delta() + event(type, new JSONObject()));
        rejects(delta());
        rejects(delta() + "data: [DONE]\n\n");
        rejects(event("response.created", new JSONObject().put("response", new JSONObject().put("id", "one"))) + completed("two"));
        rejects("event: response.failed\ndata: {\"type\":\"response.completed\"}\n\n");
    }

    @Test public void cancellationAndMalformedFramesDoNotReturnCompletedOutput() throws Exception {
        try {
            SiwcResponses.consume(new StringReader(completed("synthetic")), () -> true, partial -> { }, android.os.SystemClock.elapsedRealtime());
            fail("cancelled stream accepted");
        } catch (java.util.concurrent.CancellationException expected) { }
        rejects("data: not-json\n\n");
        rejects(event("response.completed", new JSONObject().put("response", new JSONObject()
            .put("id", "synthetic").put("status", "incomplete").put("output", new JSONArray()))));
    }

    @Test public void requestUsesPlanResponsesContractAndOnlySyntheticInput() throws Exception {
        JSONObject request = SiwcResponses.body("synthetic-model");
        assertFalse(request.getBoolean("store"));
        assertTrue(request.getBoolean("stream"));
        assertEquals(SiwcResponses.SYNTHETIC, request.getJSONArray("input").getJSONObject(0).getString("content"));
        assertEquals("user", request.getJSONArray("input").getJSONObject(0).getString("role"));
        for (String field : new String[]{"temperature", "max_output_tokens", "previous_response_id", "top_p", "messages"})
            assertFalse(request.has(field));
        try { SiwcResponses.body("invalid\r\nmodel"); fail("invalid model accepted"); }
        catch (IllegalArgumentException expected) { }
    }
}
