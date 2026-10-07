package app.narou.reader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SourceBrowserPlugin.class);
        registerPlugin(ModelStreamPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
