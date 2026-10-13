package app.trazo.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.trazo.mobile.tracker.TrazoTrackerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Los plugins locales se registran antes de inicializar el puente.
        registerPlugin(TrazoTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
