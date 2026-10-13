package app.trazo.mobile.tracker;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;

import java.util.ArrayList;
import java.util.List;

/**
 * Almacén nativo de posiciones. Cada punto se escribe aquí en cuanto llega del GPS,
 * de modo que sobrevive a la muerte de la WebView o del proceso. La capa JS los drena
 * (lee y borra en una transacción) y los guarda en IndexedDB.
 */
public final class PointStore extends SQLiteOpenHelper {
    private static final String DB = "trazo_tracker.db";
    private static final int VERSION = 1;
    private static PointStore instance;

    public static synchronized PointStore get(Context ctx) {
        if (instance == null) instance = new PointStore(ctx.getApplicationContext());
        return instance;
    }

    private PointStore(Context ctx) {
        super(ctx, DB, null, VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE fixes (session_id TEXT NOT NULL, time INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, " +
                "alt REAL, acc REAL, speed REAL, PRIMARY KEY (session_id, time))");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Sin migraciones todavía.
    }

    public void insert(String sessionId, Location l) {
        ContentValues v = new ContentValues();
        v.put("session_id", sessionId);
        v.put("time", l.getTime());
        v.put("lat", l.getLatitude());
        v.put("lng", l.getLongitude());
        if (l.hasAltitude()) v.put("alt", l.getAltitude());
        if (l.hasAccuracy()) v.put("acc", l.getAccuracy());
        if (l.hasSpeed()) v.put("speed", l.getSpeed());
        // Clave (sesión, tiempo): un mismo punto nunca se guarda dos veces.
        getWritableDatabase().insertWithOnConflict("fixes", null, v, SQLiteDatabase.CONFLICT_IGNORE);
    }

    public static final class Fix {
        public long time;
        public double lat, lng;
        public Double alt, acc, speed;
    }

    /** Puntos de la sesión posteriores a {@code afterTime} (no los borra: ver {@link #ack}). */
    public List<Fix> read(String sessionId, long afterTime, int limit) {
        List<Fix> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT time, lat, lng, alt, acc, speed FROM fixes WHERE session_id = ? AND time > ? ORDER BY time LIMIT ?",
                new String[]{sessionId, String.valueOf(afterTime), String.valueOf(limit)})) {
            while (c.moveToNext()) {
                Fix f = new Fix();
                f.time = c.getLong(0);
                f.lat = c.getDouble(1);
                f.lng = c.getDouble(2);
                f.alt = c.isNull(3) ? null : c.getDouble(3);
                f.acc = c.isNull(4) ? null : c.getDouble(4);
                f.speed = c.isNull(5) ? null : c.getDouble(5);
                out.add(f);
            }
        }
        return out;
    }

    /** La capa web confirma que ya guardó los puntos hasta {@code upTo}: se pueden borrar. */
    public void ack(String sessionId, long upTo) {
        SQLiteDatabase db = getWritableDatabase();
        db.delete("fixes", "session_id = ? AND time <= ?", new String[]{sessionId, String.valueOf(upTo)});
        // Restos de sesiones abandonadas hace más de 7 días.
        db.delete("fixes", "session_id <> ? AND time < ?", new String[]{sessionId, String.valueOf(System.currentTimeMillis() - 7L * 24 * 3600 * 1000)});
    }
}
