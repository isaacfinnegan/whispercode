package ai.opencode.mobilebridge

import android.app.Activity
import android.app.Application
import android.os.Bundle

object AppLifecycleTracker : Application.ActivityLifecycleCallbacks {
    private var foregroundActivityCount = 0

    fun isAppInForeground(): Boolean = foregroundActivityCount > 0

    override fun onActivityStarted(activity: Activity) {
        foregroundActivityCount++
    }

    override fun onActivityStopped(activity: Activity) {
        foregroundActivityCount = (foregroundActivityCount - 1).coerceAtLeast(0)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
