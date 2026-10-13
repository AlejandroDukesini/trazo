package app.trazo.mobile.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import app.trazo.mobile.MainActivity;
import app.trazo.mobile.R;

/**
 * Servicio en primer plano (tipo "location") que mantiene el GPS activo con la pantalla
 * apagada o la app en segundo plano. Se inicia desde la app en primer plano, por lo que
 * basta el permiso de ubicación "mientras se usa la app" (no requiere ACCESS_BACKGROUND_LOCATION).
 */
public class TrackerService extends Service {
    private static final String TAG = "TrazoTracker";
    static final String CHANNEL = "trazo_recording";
    static final int NOTIFICATION_ID = 4711;
    static final String PREFS = "trazo_tracker";
    static final String EXTRA_SESSION = "sessionId";
    static final String EXTRA_INTERVAL = "intervalMs";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";

    static volatile String runningSession = null;

    private FusedLocationProviderClient client;
    private LocationCallback callback;
    /** Respaldo para dispositivos sin Google Play Services (AOSP, algunos fabricantes). */
    private LocationManager locationManager;
    private LocationListener platformListener;
    private String sessionId;

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // intent == null: el sistema reinició el servicio tras matar el proceso (START_STICKY).
        String session = intent != null ? intent.getStringExtra(EXTRA_SESSION) : prefs.getString(EXTRA_SESSION, null);
        if (session == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        long interval = intent != null ? intent.getLongExtra(EXTRA_INTERVAL, 1000) : prefs.getLong(EXTRA_INTERVAL, 1000);
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : prefs.getString(EXTRA_TITLE, "Trazo está grabando");
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : prefs.getString(EXTRA_TEXT, "");
        prefs.edit().putString(EXTRA_SESSION, session).putLong(EXTRA_INTERVAL, interval).putString(EXTRA_TITLE, title).putString(EXTRA_TEXT, text).apply();

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(title, text), type);

        if (!session.equals(sessionId)) {
            stopUpdates();
            sessionId = session;
            startUpdates(interval);
        }
        runningSession = session;
        return START_STICKY;
    }

    private Notification buildNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Grabación de actividades", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Aviso persistente mientras Trazo registra tu ubicación.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_trazo)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_WORKOUT)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(pi)
                .build();
    }

    @SuppressWarnings("MissingPermission")
    private void startUpdates(long intervalMs) {
        final PointStore store = PointStore.get(this);
        final String sid = sessionId;
        boolean gms = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(this) == ConnectionResult.SUCCESS;
        try {
            if (gms) {
                client = LocationServices.getFusedLocationProviderClient(this);
                LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                        .setMinUpdateIntervalMillis(intervalMs)
                        .setMinUpdateDistanceMeters(0)
                        .setWaitForAccurateLocation(false)
                        .build();
                callback = new LocationCallback() {
                    @Override
                    public void onLocationResult(@NonNull LocationResult result) {
                        for (Location l : result.getLocations()) save(store, sid, l);
                    }
                };
                client.requestLocationUpdates(req, callback, Looper.getMainLooper());
                Log.i(TAG, "Seguimiento con FusedLocationProvider");
            } else {
                locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                platformListener = l -> save(store, sid, l);
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, platformListener, Looper.getMainLooper());
                Log.i(TAG, "Seguimiento con LocationManager (sin Google Play Services)");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "Permiso de ubicación revocado", e);
            stopSelf();
        }
    }

    private static void save(PointStore store, String sid, Location l) {
        try {
            store.insert(sid, l);
        } catch (Exception e) {
            Log.e(TAG, "No se pudo guardar el punto", e);
        }
    }

    private void stopUpdates() {
        if (client != null && callback != null) client.removeLocationUpdates(callback);
        if (locationManager != null && platformListener != null) locationManager.removeUpdates(platformListener);
        callback = null;
        platformListener = null;
    }

    @Override
    public void onDestroy() {
        stopUpdates();
        runningSession = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
