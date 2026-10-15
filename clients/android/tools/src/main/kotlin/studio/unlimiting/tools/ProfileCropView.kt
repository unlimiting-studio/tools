// 프로필 사진 크롭 화면. 고정된 정사각형 프레임 아래에서 사진을 끌고 핀치로 확대한다.
// 제스처·확대 애니메이션·딤 레이어는 uCrop(Yalantis)의 GestureCropImageView·OverlayView를 그대로 쓰고,
// 여기서는 시작 위치(자동 크롭), 프레임 모양, 그리드 표시, 결과 계산만 덧붙인다.
package studio.unlimiting.tools

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.Gravity
import android.view.MotionEvent
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ProgressBar
import com.yalantis.ucrop.view.GestureCropImageView
import com.yalantis.ucrop.view.OverlayView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** 프레임 모양. 결과 이미지는 모양과 관계없이 항상 정사각형이다. */
enum class CropShape { CIRCLE, SQUARE, ROUNDED_SQUARE }

/** 프레임 안 3×3 그리드를 언제 보일지 */
enum class GridMode { ALWAYS, WHILE_INTERACTING, HIDDEN }

data class ProfileCropOutput(
    /** 잘라낸 정사각형 이미지 */
    val bitmap: Bitmap,
    /** 이미지 크기에 대한 비율 */
    val crop: CropRect,
    /** 원본 픽셀 기준 크롭 영역 */
    val pixelRect: android.graphics.Rect,
)

class ProfileCropView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    private val imageView = FrameImageView(context)
    private val overlay = FrameOverlayView(context)
    private val progress = ProgressBar(context).apply { isIndeterminate = true; visibility = GONE }
    private var scope = MainScope()
    private var loadJob: Job? = null
    private var animator: ValueAnimator? = null

    private var source: Bitmap? = null
    /** 자동 크롭(또는 호출자가 준 시작 위치). [resetToAuto]가 돌아갈 곳이다. */
    private var autoCrop: CropRect? = null
    private var userTouched = false
    private var interacting = false

    var shape: CropShape = CropShape.CIRCLE
        set(value) { field = value; overlay.shape = value }

    var gridMode: GridMode = GridMode.WHILE_INTERACTING
        set(value) { field = value; updateGrid() }

    /** [CropShape.ROUNDED_SQUARE]의 모서리 반지름(한 변 대비 비율) */
    var cornerRadius: Float = 0.2f
        set(value) { field = value; overlay.cornerRadius = value }

    /** 프레임 바깥 딤 색 */
    var dimColor: Int = 0xB3000000.toInt()
        set(value) { field = value; overlay.dimColor = value }

    /** 프레임과 뷰 가장자리 사이 여백(px) */
    var framePadding: Int = dp(24)
        set(value) { field = value; applyPadding(); requestLayout() }

    /** 최대 확대 배율(프레임을 덮는 배율 기준) */
    var maxZoom: Float = 10f

    /** 자동 크롭을 받았을 때 */
    var onAutoCrop: ((ProfileCropRect) -> Unit)? = null

    /** 자동 크롭 요청이 실패했을 때. 가운데 크롭으로 계속 편집할 수 있다. */
    var onAutoCropError: ((Throwable) -> Unit)? = null

    /** 자동 크롭을 기다리는 중인지 */
    val isLoading: Boolean get() = loadJob?.isActive == true

    /** 이미지가 화면에 배치됐는지(테스트용) */
    internal val isLaidOutWithImage: Boolean get() = imageView.currentCrop() != null

    /** 지금 프레임 안에 보이는 영역(이미지 크기에 대한 비율). 이미지가 없으면 null */
    val crop: CropRect? get() = imageView.currentCrop() ?: imageView.target

    init {
        setBackgroundColor(Color.BLACK)
        addView(imageView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(overlay, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(progress, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        overlay.shape = shape
        overlay.dimColor = dimColor
        imageView.maxZoom = { maxZoom.toDouble() }
        applyPadding()
        updateGrid()
    }

    /**
     * 사진을 연다. EXIF 회전은 미리 적용돼 있어야 한다([ToolsClient.decodeOriented]).
     * @param initialCrop 시작 위치. null이면 가운데를 덮는 정사각형으로 시작한다.
     */
    fun setImage(bitmap: Bitmap, initialCrop: CropRect? = null) {
        cancelLoading()
        source = bitmap
        autoCrop = initialCrop
        userTouched = false
        imageView.setSource(bitmap, initialCrop ?: CropMath.centerCrop(bitmap.width, bitmap.height))
    }

    /**
     * 사진을 열고 [ToolsClient.profileCropRect]로 시작 위치를 받아온다.
     * 기다리는 동안 가운데 크롭과 진행 표시를 보여 주고, 사용자가 아직 만지지 않았으면 결과 위치로 옮긴다.
     * 실패해도 가운데 크롭으로 편집할 수 있고 [onAutoCropError]로 알린다.
     */
    fun setImage(bitmap: Bitmap, client: ToolsClient) {
        setImage(bitmap, null)
        progress.visibility = VISIBLE
        loadJob = scope.launch {
            try {
                val rect = client.profileCropRect(bitmap)
                if (source !== bitmap) return@launch
                autoCrop = rect.crop
                if (!userTouched) moveTo(rect.crop, animate = true)
                onAutoCrop?.invoke(rect)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                onAutoCropError?.invoke(e)
            } finally {
                progress.visibility = GONE
            }
        }
    }

    /** 자동 크롭 위치(없으면 가운데)로 되돌린다. */
    fun resetToAuto(animate: Boolean = true) {
        val b = source ?: return
        moveTo(autoCrop ?: CropMath.centerCrop(b.width, b.height), animate)
    }

    /** 프레임이 [crop] 영역을 보이도록 옮긴다. */
    fun moveTo(crop: CropRect, animate: Boolean = true) {
        animator?.cancel()
        val from = imageView.currentTransform()
        val to = imageView.transformFor(crop)
        imageView.target = crop
        if (!animate || from == null || to == null) {
            imageView.applyTarget()
            return
        }
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 300
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                val f = it.animatedValue as Float
                imageView.setTransform(
                    Transform(
                        from.scale + (to.scale - from.scale) * f,
                        from.tx + (to.tx - from.tx) * f,
                        from.ty + (to.ty - from.ty) * f,
                    ),
                )
            }
            start()
        }
    }

    /**
     * 지금 프레임 안의 영역을 원본 해상도로 잘라낸다.
     * @param size 출력 한 변 픽셀. null이면 원본 해상도 그대로.
     */
    fun getCroppedImage(size: Int? = null): ProfileCropOutput {
        val b = checkNotNull(source) { "이미지가 없습니다" }
        val c = crop ?: CropMath.centerCrop(b.width, b.height)
        val (bitmap, pixelRect) = ToolsClient.cropBitmap(b, c, size)
        return ProfileCropOutput(bitmap, c, pixelRect)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                animator?.cancel()
                userTouched = true
                interacting = true
                updateGrid()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                interacting = false
                // 손을 뗀 위치를 기억해 두면 화면 크기가 바뀌어도 같은 영역을 보여 준다.
                post { imageView.currentCrop()?.let { imageView.target = it }; updateGrid() }
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        overlay.setupCropBounds()
        imageView.setFrame(RectF(overlay.cropViewRect))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!scope.isActive) scope = MainScope()
    }

    override fun onDetachedFromWindow() {
        animator?.cancel()
        scope.cancel()
        progress.visibility = GONE
        super.onDetachedFromWindow()
    }

    private fun cancelLoading() {
        loadJob?.cancel()
        loadJob = null
        progress.visibility = GONE
    }

    private fun updateGrid() {
        overlay.gridVisible = when (gridMode) {
            GridMode.ALWAYS -> true
            GridMode.WHILE_INTERACTING -> interacting
            GridMode.HIDDEN -> false
        }
    }

    private fun applyPadding() {
        imageView.setPadding(framePadding, framePadding, framePadding, framePadding)
        overlay.setPadding(framePadding, framePadding, framePadding, framePadding)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
}

/**
 * uCrop의 GestureCropImageView에 시작 위치와 "항상 프레임을 덮는다" 제약을 더한다.
 * uCrop은 손을 떼면 프레임 안으로 되돌리는 방식이라, 여기서는 움직이는 동안에도 바로 막는다.
 * 회전은 쓰지 않는다.
 */
internal class FrameImageView(context: Context) : GestureCropImageView(context) {
    /** 패딩을 뺀 이미지 뷰 내부 좌표의 프레임 */
    private val frameRect = RectF()
    /** 뷰 좌표의 프레임(uCrop에 넘기는 값) */
    private val viewFrame = RectF()
    private var display: Bitmap? = null
    /** 원본 크기. 표시용 비트맵은 줄어들 수 있어 비율 계산은 원본 기준으로 한다. */
    private var srcW = 0
    private var srcH = 0
    var target: CropRect? = null
    var maxZoom: () -> Double = { 10.0 }

    init {
        isRotateEnabled = false
        isScaleEnabled = true
        setImageToWrapCropBoundsAnimDuration(200)
    }

    fun setSource(bitmap: Bitmap, crop: CropRect) {
        srcW = bitmap.width
        srcH = bitmap.height
        target = crop
        // 화면에 그릴 수 있는 크기로 줄인다(원본은 결과를 자를 때만 쓴다).
        val limit = maxBitmapSize
        val s = min(1.0, limit.toDouble() / max(bitmap.width, bitmap.height))
        val shown = if (s < 1.0) {
            Bitmap.createScaledBitmap(bitmap, max(1, (bitmap.width * s).roundToInt()), max(1, (bitmap.height * s).roundToInt()), true)
        } else bitmap
        display?.let { if (it !== bitmap && it !== shown) it.recycle() }
        display = shown
        mBitmapDecoded = true
        mBitmapLaidOut = false
        setImageBitmap(shown)
        requestLayout()
    }

    fun setFrame(viewRect: RectF) {
        if (viewRect.isEmpty) return
        val content = RectF(viewRect).apply { offset(-paddingLeft.toFloat(), -paddingTop.toFloat()) }
        // 진행 표시처럼 크기와 상관없는 레이아웃 변화에는 위치를 건드리지 않는다.
        if (content == frameRect && currentCrop() != null) return
        frameRect.set(content)
        viewFrame.set(viewRect)
        super.setCropRect(viewRect)
        cancelAllAnimations()
        applyTarget()
    }

    override fun onImageLaidOut() {
        super.onImageLaidOut()
        // uCrop은 여기서 패딩을 뺀 크롭 영역으로 되돌리므로 프레임을 다시 알려 준다.
        if (!viewFrame.isEmpty) super.setCropRect(viewFrame)
        cancelAllAnimations()
        applyTarget()
    }

    private val ready get() = mBitmapLaidOut && !frameRect.isEmpty && srcW > 0 && display != null

    private fun frame() = Frame(frameRect.left.toDouble(), frameRect.top.toDouble(), frameRect.width().toDouble())

    /** 표시용 비트맵 픽셀 → 원본 픽셀 배율 */
    private fun srcPerDisplay() = srcW.toDouble() / (display?.width ?: srcW)

    /** 원본 픽셀 기준 변환을 표시용 비트맵 기준 행렬로 */
    fun setTransform(t: Transform) {
        val k = srcPerDisplay()
        imageMatrix = Matrix().apply {
            setScale((t.scale * k).toFloat(), (t.scale * k).toFloat())
            postTranslate(t.tx.toFloat(), t.ty.toFloat())
        }
    }

    fun currentTransform(): Transform? {
        if (!ready) return null
        val v = FloatArray(9).also { imageMatrix.getValues(it) }
        return Transform(v[Matrix.MSCALE_X] / srcPerDisplay(), v[Matrix.MTRANS_X].toDouble(), v[Matrix.MTRANS_Y].toDouble())
    }

    fun transformFor(crop: CropRect): Transform? =
        if (ready) CropMath.transformFor(crop, srcW, srcH, frame(), maxScale()) else null

    fun currentCrop(): CropRect? = currentTransform()?.let { CropMath.cropFor(it, srcW, srcH, frame()) }

    fun applyTarget() {
        val t = target ?: return
        transformFor(t)?.let { setTransform(it) }
    }

    private fun coverScale() = CropMath.coverScale(frame(), srcW, srcH)
    private fun maxScale() = coverScale() * maxZoom()

    override fun postScale(deltaScale: Float, px: Float, py: Float) {
        val t = currentTransform() ?: return super.postScale(deltaScale, px, py)
        val next = (t.scale * deltaScale).coerceIn(coverScale(), maxScale())
        val d = (next / t.scale).toFloat()
        if (d != 1f) {
            // uCrop의 최소·최대 검사(맞춤 배율 기준)를 거치지 않도록 TransformImageView 단계로 바로 적용한다.
            imageMatrix = Matrix(imageMatrix).apply { postScale(d, d, px - paddingLeft, py - paddingTop) }
        }
        clampTranslation()
    }

    override fun postTranslate(deltaX: Float, deltaY: Float) {
        val t = currentTransform() ?: return super.postTranslate(deltaX, deltaY)
        val c = CropMath.clamp(Transform(t.scale, t.tx + deltaX, t.ty + deltaY), srcW, srcH, frame())
        super.postTranslate((c.tx - t.tx).toFloat(), (c.ty - t.ty).toFloat())
    }

    private fun clampTranslation() = postTranslate(0f, 0f)

    override fun getMaxScale(): Float = if (ready) (maxScale() * srcPerDisplay()).toFloat() else super.getMaxScale()

    override fun getMinScale(): Float = if (ready) (coverScale() * srcPerDisplay()).toFloat() else super.getMinScale()
}

/** uCrop의 OverlayView에 원·정사각형·둥근 정사각형 프레임과 그리드 표시 여부를 더한다. */
internal class FrameOverlayView(context: Context) : OverlayView(context) {
    var shape: CropShape = CropShape.CIRCLE
        set(value) { field = value; invalidate() }
    var dimColor: Int = 0xB3000000.toInt()
        set(value) { field = value; dimPaint.color = value; invalidate() }
    var cornerRadius = 0.2f
        set(value) { field = value; invalidate() }
    var gridVisible = false
        set(value) { if (field != value) { field = value; invalidate() } }

    private val density = resources.displayMetrics.density
    private val shapePath = Path()
    private val dimPath = Path()
    private val dimPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = dimColor }
    private val framePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = Color.WHITE
        strokeWidth = 1.5f * density
    }

    init {
        // 레이아웃 XML 없이 만들 때도 uCrop 기본 스타일(그리드 색·두께 등)을 읽어 둔다.
        val a = context.obtainStyledAttributes(null, com.yalantis.ucrop.R.styleable.ucrop_UCropView)
        processStyledAttributes(a)
        a.recycle()
        freestyleCropMode = FREESTYLE_CROP_MODE_DISABLE
        setShowCropFrame(false)
        setShowCropGrid(true)
        setCropGridRowCount(2)
        setCropGridColumnCount(2)
        setTargetAspectRatio(1f)
    }

    private fun buildPaths() {
        val r = cropViewRect
        shapePath.reset()
        when (shape) {
            CropShape.CIRCLE -> shapePath.addOval(r, Path.Direction.CW)
            CropShape.SQUARE -> shapePath.addRect(r, Path.Direction.CW)
            CropShape.ROUNDED_SQUARE -> {
                val radius = r.width() * cornerRadius
                shapePath.addRoundRect(r, radius, radius, Path.Direction.CW)
            }
        }
        dimPath.reset()
        dimPath.fillType = Path.FillType.EVEN_ODD
        dimPath.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        dimPath.addPath(shapePath)
    }

    override fun drawDimmedLayer(canvas: Canvas) {
        if (cropViewRect.isEmpty) return
        buildPaths()
        canvas.drawPath(dimPath, dimPaint)
    }

    override fun drawCropGrid(canvas: Canvas) {
        if (cropViewRect.isEmpty) return
        if (gridVisible) {
            canvas.save()
            canvas.clipPath(shapePath)
            super.drawCropGrid(canvas)
            canvas.restore()
        }
        canvas.drawPath(shapePath, framePaint)
    }
}
