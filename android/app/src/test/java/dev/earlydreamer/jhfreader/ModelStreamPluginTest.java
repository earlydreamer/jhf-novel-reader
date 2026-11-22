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
        try (BufferedReader reader = new BufferedReader(new StringReader("가나\r\n\r다\n라"))) {
            assertEquals("가나", ModelStreamPlugin.readBoundedLine(reader, 2));
            assertEquals("", ModelStreamPlugin.readBoundedLine(reader, 0));
            assertEquals("다", ModelStreamPlugin.readBoundedLine(reader, 1));
            assertEquals("라", ModelStreamPlugin.readBoundedLine(reader, 1));
            assertNull(ModelStreamPlugin.readBoundedLine(reader, -1));
        }
    }

    @Test public void stopsAtTheFirstCharacterBeyondTheLimit() throws IOException {
        try (BufferedReader reader = new BufferedReader(new StringReader("abcdef\n"))) {
            assertThrows(IOException.class, () -> ModelStreamPlugin.readBoundedLine(reader, 3));
            assertEquals('e', reader.read());
        }
    }
}
