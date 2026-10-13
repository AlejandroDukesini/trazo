package app.trazo.mobile.tracker;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.util.List;

/** Puente JS ↔ servicio nativo de seguimiento. Contrato en src/platform/tracker.ts. */
@CapacitorPlugin(
        name = "TrazoTracker",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class TrazoTrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            call.reject("sessionId requerido");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Permiso de ubicación denegado", "permission_denied");
            return;
        }
        Context ctx = getContext();
        Intent i = new Intent(ctx, TrackerService.class)
                .putExtra(TrackerService.EXTRA_SESSION, sessionId)
                .putExtra(TrackerService.EXTRA_INTERVAL, (long) call.getInt("intervalMs", 1000))
                .putExtra(TrackerService.EXTRA_TITLE, call.getString("notificationTitle", "Trazo está grabando"))
                .putExtra(TrackerService.EXTRA_TEXT, call.getString("notificationText", ""));
        try {
            ContextCompat.startForegroundService(ctx, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo iniciar el seguimiento: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(TrackerService.PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        ctx.stopService(new Intent(ctx, TrackerService.class));
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        String sessionId = call.getString("sessionId");
        if (sessionId == null) {
            call.reject("sessionId requerido");
            return;
        }
        long after = call.getLong("afterTime", 0L);
        List<PointStore.Fix> fixes = PointStore.get(getContext()).read(sessionId, after, 5000);
        JSArray arr = new JSArray();
        for (PointStore.Fix f : fixes) {
            JSObject o = new JSObject();
            o.put("time", f.time);
            o.put("lat", f.lat);
            o.put("lng", f.lng);
            o.put("alt", f.alt);
            o.put("accuracy", f.acc);
            o.put("speed", f.speed);
            arr.put(o);
        }
        JSObject res = new JSObject();
        res.put("fixes", arr);
        call.resolve(res);
    }

    @PluginMethod
    public void ack(PluginCall call) {
        String sessionId = call.getString("sessionId");
        Long upTo = call.getLong("upTo");
        if (sessionId == null || upTo == null) {
            call.reject("sessionId y upTo requeridos");
            return;
        }
        PointStore.get(getContext()).ack(sessionId, upTo);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject res = new JSObject();
        String s = TrackerService.runningSession;
        res.put("running", s != null);
        res.put("sessionId", s);
        call.resolve(res);
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject res = new JSObject();
        res.put("value", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(res);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        // Lista general de optimización de batería: no requiere el permiso restringido
        // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS.
        Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
