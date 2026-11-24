package dev.earlydreamer.jhfreader;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

/**
 * ChatGPT 로그인 콜백을 기다리는 동안만 도는 짧은 포그라운드 서비스.
 * 브라우저가 앞에 있으면 Android가 백그라운드 앱의 네트워크를 막고 프로세스를 동결해
 * 127.0.0.1 콜백 수신기가 브라우저의 연결을 받지 못한다(Android 15 이상, 절전 모드).
 */
public final class ChatGptLoginService extends Service {
    private static final String CHANNEL = "chatgpt_login";
    private static final int NOTIFICATION = 4201;
    /** 시스템이 짧은 서비스 시간을 다 썼다고 알리면 로그인 대기를 끝낸다. */
    static volatile Runnable onTimeout;

    static void start(Context context) {
        ContextCompat.startForegroundService(context, new Intent(context, ChatGptLoginService.class));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, ChatGptLoginService.class));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, getString(R.string.chatgpt_login_channel), NotificationManager.IMPORTANCE_LOW));
        }
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.chatgpt_login_waiting))
            .setOngoing(true)
            .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE : 0;
        ServiceCompat.startForeground(this, NOTIFICATION, notification, type);
        return START_NOT_STICKY;
    }

    @Override public void onTimeout(int startId) { expire(); }

    @Override public void onTimeout(int startId, int fgsType) { expire(); }

    private void expire() {
        Runnable callback = onTimeout;
        if (callback != null) callback.run();
        stopSelf();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
