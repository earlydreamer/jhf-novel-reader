package dev.earlydreamer.jhfreader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import org.junit.Test;

public class ModelStreamPluginTest {
    @Test public void acceptsExactLimitAndKeepsLineEndingsSeparate() throws IOException {
        try (BufferedReader reader = new BufferedReader(new StringReader("가나\r\n\r다\n라"), 1)) {
            ModelStreamPlugin.BoundedLineReader lines = new ModelStreamPlugin.BoundedLineReader(reader);
            assertEquals("가나", lines.readLine(2));
            assertEquals("", lines.readLine(0));
            assertEquals("다", lines.readLine(1));
            assertEquals("라", lines.readLine(1));
            assertNull(lines.readLine(-1));
        }
    }

    @Test public void returnsCrTerminatedEventWithoutWaitingForMoreInput() throws IOException {
        StringReader input = new StringReader("data: {}\r\r") {
            @Override public int read(char[] buffer, int offset, int length) throws IOException {
                int count = super.read(buffer, offset, length);
                if (count == -1) throw new IOException("More input is not available yet");
                return count;
            }
        };
        try (BufferedReader reader = new BufferedReader(input, 1)) {
            ModelStreamPlugin.BoundedLineReader lines = new ModelStreamPlugin.BoundedLineReader(reader);
            assertEquals("data: {}", lines.readLine(8));
            assertEquals("", lines.readLine(0));
        }
    }

    @Test public void stopsAtTheFirstCharacterBeyondTheLimit() throws IOException {
        try (BufferedReader reader = new BufferedReader(new StringReader("abcdef\n"))) {
            ModelStreamPlugin.BoundedLineReader lines = new ModelStreamPlugin.BoundedLineReader(reader);
            assertThrows(IOException.class, () -> lines.readLine(3));
            assertEquals('e', reader.read());
        }
    }
}
