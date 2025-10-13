/**
 * 日期时间工具函数
 */

/**
 * 将 Date 对象格式化为本地时间字符串
 * 格式：2025-10-13 14:30:25
 */
export function formatLocalDateTime(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	const seconds = String(date.getSeconds()).padStart(2, '0');

	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取当前本地时间字符串
 */
export function getCurrentLocalDateTime(): string {
	return formatLocalDateTime(new Date());
}
